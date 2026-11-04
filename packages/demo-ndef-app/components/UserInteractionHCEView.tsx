import React from 'react';
import { Alert, Button, StyleSheet, Text } from 'react-native';

import { Buffer } from 'buffer/';

import HCE, { HCESession } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from '../ndefType4TagApp.ts';
import useEventLog from './useEventLog.ts';

interface IProps {
  setCurrentView: (view: string) => void;
}

function UserInteractionHCEView({ setCurrentView }: IProps): React.JSX.Element {
  const [recentEvents, addEvent] = useEventLog();
  const [getNDEFAppState, resetNDEFAppState, handleCAPDU] = React.useMemo(
    () => createNDEFType4TagApp(),
    [],
  );
  const sessionRef = React.useRef<HCESession | null>(null);

  // close the session when the view is exited
  React.useEffect(() => () => sessionRef.current?.invalidate(), []);

  async function doBeginSession() {
    sessionRef.current?.invalidate();
    sessionRef.current = null;

    try {
      const session = await HCE.beginSession({
        onApdu: apdu => {
          const response = handleCAPDU(Buffer.from(apdu.command));

          if (getNDEFAppState().wasNDEFRead) {
            sessionRef.current?.setAlertMessage('Successfully emulated NDEF!');
          }

          return response;
        },
        onReaderDetected: () => {
          addEvent('readerDetected');
          resetNDEFAppState();
          sessionRef.current?.setAlertMessage('Reader detected');
        },
        onReaderLost: async () => {
          addEvent('readerLost');

          if (getNDEFAppState().wasNDEFRead) {
            await sessionRef.current?.stopEmulation('success');
          } else {
            sessionRef.current?.setAlertMessage('Lost reader');
          }
        },
        onInvalidated: reason => {
          addEvent('invalidated ' + reason);

          if (reason === 'maxSessionDurationReached') {
            Alert.alert(
              'Information',
              'Session has timed out and thus was invalidated by the operating system.',
            );
          }
        },
      });

      sessionRef.current = session;
      session.setAlertMessage('Tap towards the reader');
      await session.startEmulation();
      addEvent('emulation started');
    } catch (error) {
      console.error('beginSession err', error);
      Alert.alert('Error', 'Failed to begin NFC session: ' + error);
    }
  }

  return (
    <>
      <Button
        title="Back to main menu"
        onPress={() => setCurrentView('main')}
      />
      <Text style={styles.headerText}>Starting HCE after user interaction</Text>
      <Text style={styles.text}>
        Tap on the button below to start the HCE session. Then, tap your
        smartphone to the reader.
      </Text>
      <Button title="Begin HCE session&emulation" onPress={doBeginSession} />
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

export default UserInteractionHCEView;
