const withNfcHceAndroid = require('./plugin/withNfcHceAndroid')

module.exports = function withPlugin(config, props) {
    return withNfcHceAndroid(config, props)
}
