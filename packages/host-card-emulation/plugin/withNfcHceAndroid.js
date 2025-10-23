const { withAndroidManifest } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const DEFAULT_AIDS = ['A0000000031010', 'A0000000041010', 'D2760000850101']

function ensureUsesPermission(manifest) {
    const m = manifest.manifest
    if (!Array.isArray(m['uses-permission'])) m['uses-permission'] = []
    const exists = m['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === 'android.permission.NFC'
    )
    if (!exists) {
        m['uses-permission'].push({
            $: { 'android:name': 'android.permission.NFC' }
        })
    }
    return manifest
}

function ensureUsesFeature(manifest) {
    const m = manifest.manifest
    if (!Array.isArray(m['uses-feature'])) m['uses-feature'] = []
    const exists = m['uses-feature'].some(
        (f) => f.$ && f.$['android:name'] === 'android.hardware.nfc.hce'
    )
    if (!exists) {
        m['uses-feature'].push({
            $: {
                'android:name': 'android.hardware.nfc.hce',
                'android:required': 'true'
            }
        })
    }
    return manifest
}

function ensureService(manifest, serviceName) {
    const m = manifest.manifest
    if (!Array.isArray(m.application)) {
        console.warn(
            'withNfcHce: manifest.application is missing or not an array'
        )
        return manifest
    }
    const app = m.application[0]
    if (!app) {
        console.warn('withNfcHce: application element not found')
        return manifest
    }

    if (!Array.isArray(app.service)) app.service = []

    const exists = app.service.some(
        (s) => s.$ && s.$['android:name'] === serviceName
    )
    if (!exists) {
        // build service XML structure compatible with xml2js parsed object shape
        const service = {
            $: {
                'android:name': serviceName,
                'android:exported': 'true',
                'android:permission': 'android.permission.BIND_NFC_SERVICE'
            },
            'intent-filter': [
                {
                    action: [
                        {
                            $: {
                                'android:name':
                                    'android.nfc.cardemulation.action.HOST_APDU_SERVICE'
                            }
                        }
                    ],
                    category: [
                        {
                            $: {
                                'android:name':
                                    'android.intent.category.DEFAULT'
                            }
                        }
                    ]
                }
            ],
            'meta-data': [
                {
                    $: {
                        'android:name':
                            'android.nfc.cardemulation.host_apdu_service',
                        'android:resource': '@xml/aid_list'
                    }
                }
            ]
        }
        app.service.push(service)
    }
    return manifest
}

function writeAidListFile(projectRoot, appIds = []) {
    const xmlDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
        'xml'
    )
    if (!fs.existsSync(xmlDir)) fs.mkdirSync(xmlDir, { recursive: true })

    const aidItems = appIds
        .map((aid) => `        <aid-filter android:name="${aid}" />`)
        .join('\n')
    const content = `<?xml version="1.0" encoding="utf-8"?>
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:requireDeviceUnlock="false">
    <aid-group android:category="other" android:description="@string/app_name">
${aidItems}
    </aid-group>
</host-apdu-service>
`
    fs.writeFileSync(path.join(xmlDir, 'aid_list.xml'), content, {
        encoding: 'utf8'
    })
}

const withNfcHceAndroid = (config, props = {}) => {
    return withAndroidManifest(config, async (config) => {
        const appIds = (props && props.appIds) || DEFAULT_AIDS

        config.modResults = ensureUsesPermission(config.modResults)
        config.modResults = ensureUsesFeature(config.modResults)
        config.modResults = ensureService(
            config.modResults,
            'com.itsecrnd.rtnhceandroid.HCEService'
        )

        writeAidListFile(config.modRequest.projectRoot, appIds)

        return config
    })
}

module.exports = withNfcHceAndroid
