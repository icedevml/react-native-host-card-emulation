/**
 * @format
 */

import { AppRegistry } from 'react-native';
import HCE from '@icedevml/react-native-host-card-emulation';
import App from './App';
import { name as appName } from './app.json';
import createBackgroundHandler from './background';

// Android: handles HCE interactions while the app has no active session (also when it's not running),
// enabled by the meta-data of HCEService in AndroidManifest.xml
HCE.registerBackgroundHandler(createBackgroundHandler);
AppRegistry.registerComponent(appName, () => App);
