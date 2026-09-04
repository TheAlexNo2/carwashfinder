import { InterstitialAd, AdEventType } from 'react-native-google-mobile-ads';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};
const adUnitId = __DEV__
  ? 'ca-app-pub-3940256099942544/1033173712'
  : process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL || extra.admobAndroidInterstitial;

if (!adUnitId) {
  throw new Error('An Android interstitial AdMob unit ID must be configured.');
}

const interstitial = InterstitialAd.createForAdRequest(adUnitId);

export const loadInterstitial = () => {
  interstitial.load();
};

export const showInterstitial = (callback = () => {}) => {
  interstitial.addAdEventListener(AdEventType.LOADED, () => {
    interstitial.show();
    callback();
  });

  interstitial.addAdEventListener(AdEventType.ERROR, () => {
    callback();
  });

  interstitial.load();
};
