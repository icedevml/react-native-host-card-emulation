import React from 'react';
import { Alert, Button, StyleSheet, Text } from 'react-native';

import { Buffer } from 'buffer/';

import HCE, { HCESession } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from '../ndefType4TagApp.ts';
import useEventLog from './useEventLog.ts';

interface IProps {
  setCurrentView: (view: string) => void;
}

function ContinousHCEView({ setCurrentView }: IProps): React.JSX.Element {
  const [recentEvents, addEvent] = useEventLog();
  const [_getNDEFAppState, resetNDEFAppState, handleCAPDU] = React.useMemo(
    () => createNDEFType4TagApp(),
    [],
  );

  React.useEffect(() => {
    // aborting invalidates the session, even if it's still being started
    const controller = new AbortController();

    (async () => {
      let session: HCESession;

      try {
        session = await HCE.beginSession(
          {
            onApdu: apdu => {
              addEvent('apdu ' + Buffer.from(apdu.command).toString('hex'));
              return handleCAPDU(Buffer.from(apdu.command));
            },
            onReaderDetected: () => {
              addEvent('readerDetected');
              resetNDEFAppState();
            },
            onReaderLost: () => addEvent('readerLost'),
            onInvalidated: reason => {
              addEvent('invalidated ' + reason);
              setCurrentView('main');
            },
          },
          { signal: controller.signal },
        );

        await session.startEmulation();
        addEvent('emulation started');
      } catch (e) {
        if (!controller.signal.aborted) {
          console.error('failed to start HCE', e);
          Alert.alert('Error', 'Failed to start HCE: ' + e);
          setCurrentView('main');
        }
      }
    })();

    return () => controller.abort();
  }, [addEvent, resetNDEFAppState, handleCAPDU, setCurrentView]);

  return (
    <>
      <Button
        title="Back to main menu"
        onPress={() => setCurrentView('main')}
      />
      <Text style={styles.headerText}>Continous HCE operation (Android)</Text>
      <Text style={styles.text}>
        Tap the smartphone to the reader. The HCE will be operating continuously
        until this view is exited.
      </Text>
      <Text style={styles.text}>
        On iOS, this operation is time-constrained to 60 seconds.
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

export default ContinousHCEView;
