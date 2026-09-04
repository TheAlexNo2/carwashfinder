import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import Constants from 'expo-constants';

export default function Banner() {
  const extra = Constants.expoConfig?.extra || {};
  const unitId = __DEV__
    ? 'ca-app-pub-3940256099942544/6300978111'
    : process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER || extra.admobAndroidBanner;

  if (!unitId) {
    throw new Error('An Android banner AdMob unit ID must be configured.');
  }

  return (
    <BannerAd
      unitId={unitId}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
    />
  );
}
