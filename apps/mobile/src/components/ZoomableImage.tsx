import { Image } from "expo-image";
import { useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Photo with pinch-to-zoom, pan while zoomed, and double-tap to zoom in/out.
 * Reports zoom state so the parent pager can disable swiping while zoomed.
 */
export function ZoomableImage({ uri, width, height, onZoomChange }: { uri: string; width: number; height: number; onZoomChange?: (zoomed: boolean) => void }) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const report = (z: boolean) => {
    setZoomed(z);
    onZoomChange?.(z);
  };

  const clampTranslation = (s: number) => {
    "worklet";
    const maxX = ((s - 1) * width) / 2;
    const maxY = ((s - 1) * height) / 2;
    tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
    ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
  };

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedScale.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(0.8, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        reset();
        runOnJS(report)(false);
      } else {
        savedScale.value = scale.value;
        clampTranslation(scale.value);
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        runOnJS(report)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
      clampTranslation(scale.value);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        reset();
        runOnJS(report)(false);
      } else {
        // Zoom towards the tapped point.
        const s = DOUBLE_TAP_SCALE;
        scale.value = withTiming(s);
        savedScale.value = s;
        const targetX = (width / 2 - e.x) * (s - 1);
        const targetY = (height / 2 - e.y) * (s - 1);
        const maxX = ((s - 1) * width) / 2;
        const maxY = ((s - 1) * height) / 2;
        const cx = Math.min(maxX, Math.max(-maxX, targetX));
        const cy = Math.min(maxY, Math.max(-maxY, targetY));
        tx.value = withTiming(cx);
        ty.value = withTiming(cy);
        savedTx.value = cx;
        savedTy.value = cy;
        runOnJS(report)(true);
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan))}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" accessibilityIgnoresInvertColors />
      </Animated.View>
    </GestureDetector>
  );
}
