import React from 'react';
import { Alert, AppState, Button, StyleSheet, Text } from 'react-native';

import { Buffer } from 'buffer/';

import HCE, { HCESession } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from '../ndefType4TagApp.ts';
import useEventLog from './useEventLog.ts';

interface IProps {
  setCurrentView: (view: string) => void;
}

function PresentmentHCEView({ setCurrentView }: IProps): React.JSX.Element {
  const [exclusiveNFCAcquired, setExclusiveNFCAcquired] = React.useState(false);
  const [recentEvents, addEvent] = useEventLog();
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
        setCurrentView('main');
      }
    });

    (async () => {
      try {
        await HCE.acquireExclusiveNFC();
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

      let session: HCESession | null = null;

      try {
        session = await HCE.beginSession(
          {
            onApdu: apdu => {
              const response = handleCAPDU(Buffer.from(apdu.command));

              if (getNDEFAppState().wasNDEFRead) {
                session?.setAlertMessage('Done. Untap smartphone from the reader.');
              }

              return response;
            },
            // start HCE whenever the reader is detected, without any user interaction
            onReaderDetected: async () => {
              addEvent('readerDetected');
              hceTriggered = true;
              resetNDEFAppState();
              session?.setAlertMessage('Detected reader.');
              await session?.startEmulation();
            },
            // stop it with success whenever NDEF was read
            onReaderLost: async () => {
              addEvent('readerLost');

              if (getNDEFAppState().wasNDEFRead && (await session?.isEmulationRunning())) {
                await session?.stopEmulation('success');
                hceTriggered = false;
              }
            },
            onInvalidated: reason => {
              addEvent('invalidated ' + reason);
              setCurrentView('main');
            },
          },
          { signal: controller.signal },
        );
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
    };
  }, [addEvent, getNDEFAppState, resetNDEFAppState, handleCAPDU, setCurrentView]);

  if (!exclusiveNFCAcquired) {
    return <Text style={styles.text}>Please wait...</Text>;
  }

  return (
    <>
      <Button
        title="Back to main menu"
        onPress={() => setCurrentView('main')}
      />
      <Text style={styles.headerText}>
        HCE interaction with Presentment Intent (iOS)
      </Text>
      <Text style={styles.text}>
        Exclusive NFC access was acquired for 15 seconds. Tap the smartphone to
        the reader.
      </Text>
      <Text style={styles.text}>
        The HCE interaction will start automatically after the reader field is
        detected.
      </Text>
      <Text style={styles.text}>{recentEvents}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  text: {
    margin: 10,
    fontSize: 20,
    color: 'black',
  },
  headerText: {
    margin: 10,
    fontSize: 20,
    fontWeight: 'bold',
    color: 'black',
  },
});

export default PresentmentHCEView;
