import React from 'react';
import { Platform, Text } from 'react-native';

import EventLogView from './EventLogView.tsx';
import { ActionButton, Section, textStyles } from './ui.tsx';

interface IProps {
  setCurrentView: (view: string) => void;
}

function MainView({ setCurrentView }: IProps): React.JSX.Element {
  return (
    <>
      <Section title="Select demo">
        <ActionButton
          title="Start HCE after user interaction"
          subtitle="iOS / Android"
          onPress={() => setCurrentView('user-interaction')}
        />
        <ActionButton
          title="HCE interaction with Presentment Intent"
          subtitle="iOS only"
          disabled={Platform.OS !== 'ios'}
          onPress={() => setCurrentView('ios-presentment')}
        />
        <ActionButton
          title="Continuous HCE operation"
          subtitle="iOS / Android"
          onPress={() => setCurrentView('continous')}
        />
        <Text style={textStyles.hint}>
          On Android, the app also handles taps in background, even when it's
          not open.
        </Text>
      </Section>
      <EventLogView />
    </>
  );
}

export default MainView;
