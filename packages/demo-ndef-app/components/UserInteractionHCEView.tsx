import React from 'react';
import { Alert, Text } from 'react-native';

import { Buffer } from 'buffer/';

import HCE, { HCESession } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from '../ndefType4TagApp.ts';
import createBackgroundHandler from '../background.ts';
import { logApdu, logEvent } from './eventLog.ts';
import EventLogView from './EventLogView.tsx';
import { ActionButton, BackButton, Section, textStyles } from './ui.tsx';

interface IProps {
  setCurrentView: (view: string) => void;
}

function UserInteractionHCEView({ setCurrentView }: IProps): React.JSX.Element {
  const [getNDEFAppState, resetNDEFAppState, handleCAPDU] = React.useMemo(
    () => createNDEFType4TagApp('https://example.com/'),
    [],
  );
  const sessionRef = React.useRef<HCESession | null>(null);
  // identifies the current session, so that the events of the replaced ones don't change the UI
  const generationRef = React.useRef(0);
  const [emulating, setEmulating] = React.useState(false);

  React.useEffect(() => {
    // in this demo, nothing happens until the user starts the emulation
    HCE.unregisterBackgroundHandler();
    logEvent('HCE.unregisterBackgroundHandler()');

    return () => {
      invalidateSession();
      HCE.registerBackgroundHandler(createBackgroundHandler);
      logEvent('HCE.registerBackgroundHandler()');
    };
  }, []);

  function invalidateSession() {
    if (sessionRef.current) {
      sessionRef.current.invalidate();
      sessionRef.current = null;
      logEvent('HCESession.invalidate()');
    }
  }

  function stopSession() {
    generationRef.current++;
    invalidateSession();
    setEmulating(false);
  }

  async function doBeginSession() {
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;

    invalidateSession();
    setEmulating(true);

    try {
      const session = await HCE.beginSession({
        onApdu: apdu => {
          const command = Buffer.from(apdu.command);
          const response = handleCAPDU(command);
          logApdu(command, response);

          if (getNDEFAppState().wasNDEFRead) {
            sessionRef.current?.setAlertMessage('Successfully emulated NDEF!');
          }

          return response;
        },
        onReaderDetected: () => {
          logEvent('onReaderDetected()');
          resetNDEFAppState();
          sessionRef.current?.setAlertMessage('Reader detected');
        },
        onReaderLost: async () => {
          logEvent('onReaderLost()');

          if (getNDEFAppState().wasNDEFRead) {
            await sessionRef.current?.stopEmulation('success');
            logEvent('HCESession.stopEmulation(success)');

            if (isCurrent()) {
              setEmulating(false);
            }
          } else {
            sessionRef.current?.setAlertMessage('Lost reader');
          }
        },
        onInvalidated: reason => {
          logEvent(`onInvalidated(${reason})`);

          if (isCurrent()) {
            setEmulating(false);
          }

          if (reason === 'maxSessionDurationReached') {
            Alert.alert(
              'Information',
              'Session has timed out and thus was invalidated by the operating system.',
            );
          }
        },
      });

      sessionRef.current = session;
      logEvent('HCE.beginSession()');
      session.setAlertMessage('Tap towards the reader');
      await session.startEmulation();
      logEvent('HCESession.startEmulation()');
    } catch (error) {
      if (isCurrent()) {
        setEmulating(false);
      }

      console.error('beginSession err', error);
      Alert.alert('Error', 'Failed to begin NFC session: ' + error);
    }
  }

  return (
    <>
      <BackButton onPress={() => setCurrentView('main')} />
      <Section title="Starting HCE after user interaction">
        <Text style={textStyles.body}>
          Tap on the button below to start the HCE session. Then, tap your
          smartphone to the reader.
        </Text>
        <Text style={textStyles.hint}>
          The emulated tag contains https://example.com/. Background handling is
          disabled while this view is open.
        </Text>
        <ActionButton
          title={emulating ? 'Emulation running' : 'Begin HCE session & emulation'}
          subtitle={emulating ? 'Tap to stop' : undefined}
          active={emulating}
          onPress={emulating ? stopSession : doBeginSession}
        />
      </Section>
      <EventLogView />
    </>
  );
}

export default UserInteractionHCEView;
