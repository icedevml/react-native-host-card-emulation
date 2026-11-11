import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import MainView from './components/MainView.tsx';
import UserInteractionHCEView from './components/UserInteractionHCEView.tsx';
import PresentmentHCEView from './components/PresentmentHCEView.tsx';
import ContinousHCEView from './components/ContinousHCEView.tsx';
import { colors } from './components/ui.tsx';

function App(): React.JSX.Element {
  const [currentView, setCurrentView] = React.useState<string>("main");

  const renderCurrentView = () => {
    if (currentView === 'main') {
      return <MainView setCurrentView={setCurrentView} />;
    } else if (currentView === 'user-interaction') {
      return <UserInteractionHCEView setCurrentView={setCurrentView} />;
    } else if (currentView === 'ios-presentment') {
      return <PresentmentHCEView setCurrentView={setCurrentView} />;
    } else if (currentView === 'continous') {
      return <ContinousHCEView setCurrentView={setCurrentView} />;
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
      <SafeAreaView style={styles.safeAreaView}>
        <View style={styles.header}>
          <Text style={styles.title}>HCE Module Demo</Text>
          <Text style={styles.subtitle}>
            github.com/icedevml/react-native-host-card-emulation
          </Text>
        </View>
        <View style={styles.content}>{renderCurrentView()}</View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
});

export default App;
