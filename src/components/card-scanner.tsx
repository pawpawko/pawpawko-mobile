import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameOutput } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-ocr-plus';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, fonts } from '@/lib/theme';

// VisionCamera-backed live OCR camera for the card-scan flow. Streams every
// recognized text blob up to the parent via onText (throttled natively by
// frameSkipThreshold); the parent parses it into card codes and routes to the
// result sheet (CARD) or the tray (PAGE). isActive is driven by `paused` so the
// camera idles while a result sheet / tray / picker is open.
export function CardScanner({ paused, onText }: { paused: boolean; onText: (text: string) => void }) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin', frameSkipThreshold: 5 });

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb', // required on Android
    onFrame: (frame) => {
      'worklet';
      const result = scanText(frame);
      if (result.resultText) scheduleOnRN(onText, result.resultText);
      frame.dispose();
    },
  });

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  if (!hasPermission) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={styles.text}>Camera permission is needed to scan cards.</Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={styles.text}>No camera found.</Text>
      </View>
    );
  }
  return (
    <Camera style={StyleSheet.absoluteFill} device={device} isActive={!paused} outputs={[frameOutput]} />
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', padding: 32 },
  text: { color: colors.textPrimary, fontFamily: fonts.body, textAlign: 'center' },
});
