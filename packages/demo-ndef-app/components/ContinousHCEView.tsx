import React from 'react';
import { Alert, Text } from 'react-native';

import { Buffer } from 'buffer/';

import HCE, { HCESession } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from '../ndefType4TagApp.ts';
import { logApdu, logEvent } from './eventLog.ts';
import EventLogView from './EventLogView.tsx';
import { BackButton, Section, textStyles } from './ui.tsx';

interface IProps {
  setCurrentView: (view: string) => void;
}

function ContinousHCEView({ setCurrentView }: IProps): React.JSX.Element {
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
              const command = Buffer.from(apdu.command);
              const response = handleCAPDU(command);
              logApdu(command, response);
              return response;
            },
            onReaderDetected: () => {
              logEvent('onReaderDetected()');
              resetNDEFAppState();
            },
            onReaderLost: () => logEvent('onReaderLost()'),
            onInvalidated: reason => {
              logEvent(`onInvalidated(${reason})`);
              setCurrentView('main');
            },
          },
          { signal: controller.signal },
        );
        logEvent('HCE.beginSession()');

        await session.startEmulation();
        logEvent('HCESession.startEmulation()');
      } catch (e) {
        if (!controller.signal.aborted) {
          console.error('failed to start HCE', e);
          Alert.alert('Error', 'Failed to start HCE: ' + e);
          setCurrentView('main');
        }
      }
    })();

    return () => controller.abort();
  }, [resetNDEFAppState, handleCAPDU, setCurrentView]);

  return (
    <>
      <BackButton onPress={() => setCurrentView('main')} />
      <Section title="Continuous HCE operation">
        <Text style={textStyles.body}>
          Tap the smartphone to the reader. The HCE will be operating
          continuously until this view is exited.
        </Text>
        <Text style={textStyles.hint}>
          On iOS, this operation is time-constrained to 60 seconds.
        </Text>
      </Section>
      <EventLogView />
    </>
  );
}

export default ContinousHCEView;
