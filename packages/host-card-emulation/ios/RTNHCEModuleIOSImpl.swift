import Foundation
import CoreNFC
#if canImport(React)
// SwiftPM has no bridging header, RCTPromiseResolveBlock/RCTPromiseRejectBlock come from the React module
import React
#endif

enum HexCoding {
  private static let hexDigits = Array("0123456789ABCDEF".utf8)

  static func encode(_ data: Data) -> String {
    var out = [UInt8]()
    out.reserveCapacity(data.count * 2)

    for byte in data {
      out.append(hexDigits[Int(byte >> 4)])
      out.append(hexDigits[Int(byte & 0x0F)])
    }

    return String(decoding: out, as: UTF8.self)
  }

  /// Strict decoding, returns nil for odd length or non-hex characters.
  static func decode(_ string: String) -> Data? {
    let chars = Array(string.utf8)

    guard chars.count % 2 == 0 else {
      return nil
    }

    func nibble(_ c: UInt8) -> UInt8? {
      switch c {
      case 0x30...0x39: return c - 0x30
      case 0x41...0x46: return c - 0x41 + 10
      case 0x61...0x66: return c - 0x61 + 10
      default: return nil
      }
    }

    var data = Data(capacity: chars.count / 2)
    var i = 0

    while i < chars.count {
      guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else {
        return nil
      }

      data.append((hi << 4) | lo)
      i += 2
    }

    return data
  }
}

@available(iOS 17.4, *)
@objc public class RTNHCEModuleIOSImpl: NSObject {
  private struct PendingAPDU {
    let id: Int64
    let apdu: CardSession.APDU
  }

  private struct EmulationStart {
    let sessionId: String
    let task: Task<Void, Error>
  }

  // how long beginSession() waits for the previous CardSession to end
  private static let previousSessionEndTimeout: UInt64 = 5_000_000_000
  private static let previousSessionPollInterval: UInt64 = 50_000_000

  /*
   All the mutable state below is guarded by `lock`. It is accessed concurrently from
   the TurboModule method queue, the JS thread (synchronous methods) and the Swift
   concurrency thread pool (Tasks). Never hold the lock across an `await`.
   */
  private let lock = NSLock()
  private var currentSessionId: String? = nil
  private var currentSession: CardSession? = nil
  private var startingSessionId: String? = nil
  private var startingSessionInvalidateRequested: Bool = false
  private var pendingAPDU: PendingAPDU? = nil
  private var lastAPDUId: Int64 = 0
  // the number of event loops that are still running, including the ones of invalidated sessions
  private var runningEventLoops: Int = 0
  private var emulationStart: EmulationStart? = nil
  private var presentmentIntent: NFCPresentmentIntentAssertion? = nil
  private var presentmentIntentAcquiring: Bool = false
  private var emitOnEvent: ((NSDictionary) -> ())? = nil

  private func synchronized<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }

  private func emit(_ sessionId: String, _ type: String, apduId: Int64 = 0, command: String = "", reason: String = "") {
    let callback = synchronized { self.emitOnEvent }
    let payload: [String: Any] = [
      "sessionId": sessionId,
      "type": type,
      "apduId": NSNumber(value: Double(apduId)),
      "command": command,
      // it's impossible to communicate over HCE while the device is locked
      "deviceLocked": NSNumber(value: false),
      "reason": reason,
    ]
    callback?(payload as NSDictionary)
  }

  /// Must be called while holding the lock.
  private func sessionIfCurrent(_ sessionId: String) -> CardSession? {
    return currentSessionId == sessionId ? currentSession : nil
  }

  /// Only a single CardSession may exist at a time, so wait until the event loops of the previous ones have ended.
  private func waitForPreviousSessionsToEnd() async -> Bool {
    var waited: UInt64 = 0

    while synchronized({ self.runningEventLoops > 0 }) {
      if waited >= Self.previousSessionEndTimeout {
        return false
      }

      try? await Task.sleep(nanoseconds: Self.previousSessionPollInterval)
      waited += Self.previousSessionPollInterval
    }

    return true
  }

  @objc public func setEmitOnEvent(emitOnEvent: @escaping (NSDictionary) -> ()) {
    synchronized { self.emitOnEvent = emitOnEvent }
  }

  @objc public func getCapabilities(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    Task.init {
      let hceSupported = CardSession.isSupported
      let nfcEnabled = NFCReaderSession.readingAvailable
      let eligible = hceSupported ? await CardSession.isEligible : false

      let capabilities: [String: Any] = [
        "platform": "ios",
        "hceSupported": hceSupported,
        "nfcEnabled": nfcEnabled,
        "eligible": eligible,
        "backgroundSupported": false,
        "presentmentSupported": hceSupported,
      ]
      resolve(capabilities as NSDictionary)
    }
  }

  // MARK: - Exclusive NFC access

  @objc public func acquireExclusiveNFC(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    Task.init {
      guard NFCReaderSession.readingAvailable else {
        reject("err_nfc_reader_not_available", "Preflight check failed: NFCReaderSession.readingAvailable is false", nil)
        return
      }

      guard CardSession.isSupported else {
        reject("err_card_session_unsupported", "Preflight check failed: CardSession.isSupported is false", nil)
        return
      }

      guard await CardSession.isEligible else {
        reject("err_card_session_not_eligible", "Preflight check failed: CardSession.isEligible is false", nil)
        return
      }

      // reserve the acquisition atomically, so that concurrent calls can't both pass the check
      let (canAcquire, previousIntent) = self.synchronized { () -> (Bool, NFCPresentmentIntentAssertion?) in
        if self.presentmentIntentAcquiring || (self.presentmentIntent?.isValid ?? false) {
          return (false, nil)
        }

        let previous = self.presentmentIntent
        self.presentmentIntent = nil
        self.presentmentIntentAcquiring = true
        return (true, previous)
      }
      // the expired assertion (if any) is released here, outside of the lock
      _ = previousIntent

      guard canAcquire else {
        reject("err_already_exists", "NFCPresentmentIntentAssertion already exists and is valid.", nil)
        return
      }

      do {
        let intent = try await NFCPresentmentIntentAssertion.acquire()
        self.synchronized {
          self.presentmentIntent = intent
          self.presentmentIntentAcquiring = false
        }
      } catch (let error) {
        self.synchronized { self.presentmentIntentAcquiring = false }
        reject("err_acquire_presentment", "Failed to acquire NFCPresentmentIntentAssertion: \(error)", nil)
        return
      }

      resolve(nil)
    }
  }

  @objc public func releaseExclusiveNFC() {
    let previousIntent = synchronized { () -> NFCPresentmentIntentAssertion? in
      let previous = self.presentmentIntent
      self.presentmentIntent = nil
      return previous
    }
    // the assertion is released here, outside of the lock
    _ = previousIntent
  }

  @objc public func isExclusiveNFC() -> Bool {
    return synchronized { self.presentmentIntent?.isValid ?? false }
  }

  // MARK: - Session

  @objc public func beginSession(sessionId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let sessionId = String(sessionId)

    Task.init {
      guard NFCReaderSession.readingAvailable else {
        reject("err_nfc_reader_not_available", "Preflight check failed: NFCReaderSession.readingAvailable is false", nil)
        return
      }

      guard CardSession.isSupported else {
        reject("err_card_session_unsupported", "Preflight check failed: CardSession.isSupported is false", nil)
        return
      }

      guard await CardSession.isEligible else {
        reject("err_card_session_not_eligible", "Preflight check failed: CardSession.isEligible is false", nil)
        return
      }

      // reserve the session slot atomically, so that concurrent calls can't both pass the check
      let canStart = self.synchronized { () -> Bool in
        if self.currentSession != nil || self.startingSessionId != nil {
          return false
        }

        self.startingSessionId = sessionId
        self.startingSessionInvalidateRequested = false
        return true
      }

      guard canStart else {
        reject("err_session_exists", "A session already exists.", nil)
        return
      }

      // the previous session might still be ending, e.g. if it was invalidated right before this call
      guard await self.waitForPreviousSessionsToEnd() else {
        self.synchronized { self.startingSessionId = nil }
        reject("err_session_exists", "The previous session is still being closed.", nil)
        return
      }

      let session: CardSession

      do {
        session = try await CardSession()
      } catch (let error) {
        self.synchronized { self.startingSessionId = nil }
        reject("err_create_card_session", "Failed to create CardSession: \(error)", nil)
        return
      }

      let invalidateRequested = self.synchronized { () -> Bool in
        self.startingSessionId = nil
        // the event loop below runs in both cases
        self.runningEventLoops += 1

        if self.startingSessionInvalidateRequested {
          // invalidateSession() was called while the session was being created
          return true
        }

        self.currentSessionId = sessionId
        self.currentSession = session
        self.pendingAPDU = nil
        return false
      }

      if invalidateRequested {
        session.invalidate()
      }

      resolve(nil)
      await self.runEventLoop(sessionId: sessionId, session: session)
    }
  }

  /*
   Process events of the given session. The loop always operates on its own session object,
   as the current session might be cleared or replaced by a newer one at any time.
   */
  private func runEventLoop(sessionId: String, session: CardSession) async {
    var invalidationReason: String? = nil

    do {
      for try await event in session.eventStream {
        switch event {
        case .sessionStarted:
          session.alertMessage = String(localized: "Communicating with card reader.")
          emit(sessionId, "sessionStarted")

        case .readerDetected:
          emit(sessionId, "readerDetected")

        case .readerDeselected:
          synchronized {
            if self.currentSessionId == sessionId {
              self.pendingAPDU = nil
            }
          }
          emit(sessionId, "readerLost")

        case .received(let cardAPDU):
          let apduId = synchronized { () -> Int64? in
            guard self.currentSessionId == sessionId else {
              return nil
            }

            self.lastAPDUId += 1
            self.pendingAPDU = PendingAPDU(id: self.lastAPDUId, apdu: cardAPDU)
            return self.lastAPDUId
          }

          guard let apduId = apduId else {
            // C-APDU of a session that was already invalidated, nobody can respond to it
            continue
          }

          emit(sessionId, "apdu", apduId: apduId, command: HexCoding.encode(cardAPDU.payload))

        case .sessionInvalidated(let reason):
          invalidationReason = "\(reason)"

        @unknown default:
          // don't crash on event types introduced by future iOS versions
          NSLog("RTNHCEModuleIOS: ignoring unknown CardSession event: %@", String(describing: event))
        }

        if invalidationReason != nil {
          break
        }
      }
    } catch (let error) {
      invalidationReason = "internalError: \(error)"
    }

    // the event stream has ended, make sure that the module doesn't stay stuck with a dead session
    let wasCurrent = synchronized { () -> Bool in
      guard self.currentSessionId == sessionId else {
        return false
      }

      self.currentSessionId = nil
      self.currentSession = nil
      self.pendingAPDU = nil
      return true
    }

    if wasCurrent {
      session.invalidate()
    }

    // only now a new CardSession can be created
    synchronized { self.runningEventLoops -= 1 }
    emit(sessionId, "sessionInvalidated", reason: invalidationReason ?? "unknown")
  }

  @objc public func invalidateSession(sessionId: NSString) {
    let sessionId = String(sessionId)

    let session = synchronized { () -> CardSession? in
      if self.startingSessionId == sessionId {
        self.startingSessionInvalidateRequested = true
      }

      guard self.currentSessionId == sessionId else {
        return nil
      }

      let current = self.currentSession
      self.currentSessionId = nil
      self.currentSession = nil
      self.pendingAPDU = nil
      return current
    }

    session?.invalidate()
  }

  /// Called when the native module is being torn down (e.g. JS reload).
  @objc public func invalidateAll() {
    let session = synchronized { () -> CardSession? in
      if self.startingSessionId != nil {
        self.startingSessionInvalidateRequested = true
      }

      let current = self.currentSession
      self.currentSessionId = nil
      self.currentSession = nil
      self.pendingAPDU = nil
      self.emitOnEvent = nil
      return current
    }

    session?.invalidate()
    releaseExclusiveNFC()
  }

  @objc public func setSessionAlertMessage(sessionId: NSString, message: NSString) {
    let session = synchronized { self.sessionIfCurrent(String(sessionId)) }
    session?.alertMessage = String(message)
  }

  @objc public func startEmulation(sessionId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let sessionId = String(sessionId)

    Task.init {
      // concurrent calls share a single attempt, so that the emulation is never started twice
      let task = self.synchronized { () -> Task<Void, Error>? in
        guard let session = self.sessionIfCurrent(sessionId) else {
          return nil
        }

        if let start = self.emulationStart, start.sessionId == sessionId {
          return start.task
        }

        let task = Task<Void, Error> {
          if await session.isEmulationInProgress {
            return
          }

          try await session.startEmulation()
        }

        self.emulationStart = EmulationStart(sessionId: sessionId, task: task)
        return task
      }

      guard let task = task else {
        reject("err_no_session", "The session is not active.", nil)
        return
      }

      let result = await task.result

      self.synchronized {
        if self.emulationStart?.task == task {
          self.emulationStart = nil
        }
      }

      switch result {
      case .success:
        resolve(nil)
      case .failure(let error):
        reject("err_start_emulation", "Error trying to start emulation. \(error)", nil)
      }
    }
  }

  @objc public func stopEmulation(sessionId: NSString, status: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let sessionId = String(sessionId)
    let success = String(status) == "success"

    Task.init {
      let session = self.synchronized { () -> CardSession? in
        let session = self.sessionIfCurrent(sessionId)

        if session != nil {
          self.pendingAPDU = nil
        }

        return session
      }

      guard let session = session else {
        reject("err_no_session", "The session is not active.", nil)
        return
      }

      await session.stopEmulation(status: success ? .success : .failure)
      resolve(nil)
    }
  }

  @objc public func isEmulationRunning(sessionId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let sessionId = String(sessionId)

    Task.init {
      guard let session = self.synchronized({ self.sessionIfCurrent(sessionId) }) else {
        resolve(false)
        return
      }

      resolve(await session.isEmulationInProgress)
    }
  }

  @objc public func respondApdu(sessionId: NSString, apduId: Double, rapdu: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let sessionId = String(sessionId)

    // Int64(_:) would crash on NaN, infinity or an out of range value
    guard let apduId = Int64(exactly: apduId) else {
      reject("err_invalid_argument", "The APDU identifier must be an integer.", nil)
      return
    }

    guard let response = HexCoding.decode(String(rapdu)), response.count >= 2 else {
      reject("err_invalid_rapdu", "The R-APDU must be a hex-encoded string of at least 2 bytes.", nil)
      return
    }

    // take the C-APDU atomically, so it's responded to at most once
    let pending = synchronized { () -> PendingAPDU? in
      guard self.currentSessionId == sessionId, let pending = self.pendingAPDU, pending.id == apduId else {
        return nil
      }

      self.pendingAPDU = nil
      return pending
    }

    guard let pending = pending else {
      reject("err_stale_apdu", "The C-APDU is not awaiting a response (reader lost or session closed).", nil)
      return
    }

    Task.init {
      do {
        try await pending.apdu.respond(response: response)
      } catch (let error) {
        reject("err_apdu_respond", "Error trying to respond to APDU. \(error)", nil)
        return
      }

      resolve(nil)
    }
  }
}
