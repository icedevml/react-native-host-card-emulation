import React from 'react';
import { Alert, AppState, Text } from 'react-native';

import { Buffer } from 'buffer/';

import HCE from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from '../ndefType4TagApp.ts';
import { logApdu, logEvent } from './eventLog.ts';
import EventLogView from './EventLogView.tsx';
import { BackButton, Section, textStyles } from './ui.tsx';

interface IProps {
  setCurrentView: (view: string) => void;
}

function PresentmentHCEView({ setCurrentView }: IProps): React.JSX.Element {
  const [exclusiveNFCAcquired, setExclusiveNFCAcquired] = React.useState(false);
  const [getNDEFAppState, resetNDEFAppState, handleCAPDU] = React.useMemo(
    () => createNDEFType4TagApp(),
    [],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    let checkIntervalId: ReturnType<typeof setInterval> | null = null;
    let hceTriggered = false;

    // release exclusive NFC access after the app went to background
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background') {
        HCE.releaseExclusiveNFC();
        logEvent('HCE.releaseExclusiveNFC()');
        setCurrentView('main');
      }
    });

    (async () => {
      try {
        await HCE.acquireExclusiveNFC();
        logEvent('HCE.acquireExclusiveNFC()');
      } catch (e) {
        if (!controller.signal.aborted) {
          Alert.alert(
            'Error',
            'Failed to acquire exclusive NFC access. You might be in the 15s cooldown period.\n\n' +
              String(e),
          );
          setCurrentView('main');
        }
        return;
      }

      if (controller.signal.aborted) {
        HCE.releaseExclusiveNFC();
        logEvent('HCE.releaseExclusiveNFC()');
        return;
      }

      setExclusiveNFCAcquired(true);

      // navigate back to the main view once the exclusive NFC access has expired
      checkIntervalId = setInterval(() => {
        if (!hceTriggered && !HCE.isExclusiveNFC()) {
          console.log('exclusive NFC timeout triggered');
          setCurrentView('main');
        }
      }, 250);

      try {
        await HCE.beginSession(
          {
            onApdu: (apdu, session) => {
              const command = Buffer.from(apdu.command);
              const response = handleCAPDU(command);
              logApdu(command, response);

              if (getNDEFAppState().wasNDEFRead) {
                session.setAlertMessage('Done. Untap smartphone from the reader.');
              }

              return response;
            },
            // start HCE whenever the reader is detected, without any user interaction
            onReaderDetected: async session => {
              logEvent('onReaderDetected()');
              hceTriggered = true;
              resetNDEFAppState();
              session.setAlertMessage('Detected reader.');
              await session.startEmulation();
              logEvent('HCESession.startEmulation()');
            },
            // stop it with success whenever NDEF was read
            onReaderLost: async session => {
              logEvent('onReaderLost()');

              if (getNDEFAppState().wasNDEFRead && (await session.isEmulationRunning())) {
                await session.stopEmulation('success');
                logEvent('HCESession.stopEmulation(success)');
                hceTriggered = false;
              }
            },
            onInvalidated: reason => {
              logEvent(`onInvalidated(${reason})`);
              setCurrentView('main');
            },
          },
          { signal: controller.signal },
        );
        logEvent('HCE.beginSession()');
      } catch (e) {
        if (!controller.signal.aborted) {
          Alert.alert('Error', 'Failed to begin NFC session: ' + e);
          setCurrentView('main');
        }
      }
    })();

    return () => {
      controller.abort();
      appStateSubscription.remove();

      if (checkIntervalId !== null) {
        clearInterval(checkIntervalId);
      }

      HCE.releaseExclusiveNFC();
      logEvent('HCE.releaseExclusiveNFC()');
    };
  }, [getNDEFAppState, resetNDEFAppState, handleCAPDU, setCurrentView]);

  if (!exclusiveNFCAcquired) {
    return <Text style={textStyles.body}>Please wait...</Text>;
  }

  return (
    <>
      <BackButton onPress={() => setCurrentView('main')} />
      <Section title="HCE interaction with Presentment Intent (iOS)">
        <Text style={textStyles.body}>
          Exclusive NFC access was acquired for 15 seconds. Tap the smartphone
          to the reader.
        </Text>
        <Text style={textStyles.hint}>
          The HCE interaction will start automatically after the reader field
          is detected.
        </Text>
      </Section>
      <EventLogView />
    </>
  );
}

export default PresentmentHCEView;
