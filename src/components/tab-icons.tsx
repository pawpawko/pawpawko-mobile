import { type ColorValue } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/lib/theme-context';

type IconProps = { color: ColorValue; size: number };

// Decks tab — two overlapping playing cards (svgrepo 410347 "cards").
// The front card is filled with the tab-bar background so it cleanly occludes
// the tilted card behind it; only the stroke takes the active/inactive tint.
export function CardsIcon({ color, size }: IconProps) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G>
        <Rect
          x="9"
          y="2.6"
          width="10.5"
          height="14.5"
          rx="2.2"
          stroke={color}
          strokeWidth={1.7}
          fill={colors.bgSecondary}
          rotation={20}
          originX={14.25}
          originY={9.85}
        />
        <Rect
          x="4.5"
          y="6.9"
          width="10.5"
          height="14.5"
          rx="2.2"
          stroke={color}
          strokeWidth={1.7}
          fill={colors.bgSecondary}
        />
      </G>
    </Svg>
  );
}

// Binders tab — an open book with a center spine (svgrepo 532906 "book-open").
// Two facing pages, each closed back to the spine so the straight center line
// is drawn for free.
export function BookOpenIcon({ color, size }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 6.8C9.3 5 6.2 4.6 3.4 5.2L3.4 17.7C6.2 17.1 9.3 17.5 12 19.3Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M12 6.8C14.7 5 17.8 4.6 20.6 5.2L20.6 17.7C17.8 17.1 14.7 17.5 12 19.3Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
