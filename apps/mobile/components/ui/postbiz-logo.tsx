import { Image } from "expo-image";
import { View } from "react-native";

type PostbizLogoProps = {
  width?: number;
  height?: number;
};

export function PostbizLogo({ width = 84, height = 27.359 }: PostbizLogoProps) {
  return (
    <View style={{ width, height }}>
      <View className="absolute inset-0 right-[70.6%]">
        <Image
          source={require("@/assets/icons/login/postbiz-mark.svg")}
          style={{ width: width * 0.294048, height }}
          contentFit="contain"
        />
      </View>

      <View className="absolute top-[1.61%] bottom-[10.76%] left-[37.32%] right-0">
        <Image
          source={require("@/assets/icons/login/postbiz-wordmark.svg")}
          style={{ width: width * 0.626786, height: height * 0.87649 }}
          contentFit="contain"
        />
      </View>
    </View>
  );
}
