// Festival Gold — warm cream + marigold light theme (2026-06-26), plus the
// "Charcoal Festival" dark theme (variant C, chosen 2026-06-27). Mirrors web
// css/styles.css :root + html[data-theme="dark"]. See reference-pawpawko-theme.
//
// `colors` stays exported as the LIGHT palette for back-compat while screens are
// migrated to the runtime theme. New code should read the active palette from
// useTheme() (lib/theme-context) so it reacts to the Profile dark-mode toggle.

export const lightColors = {
  bgPrimary: '#fbf3e2',
  bgSecondary: '#fffdf8',
  bgCard: '#ffffff',
  bgCardHover: '#fdf6e9',
  accent: '#f0a818',
  accentLight: '#ffc859',
  accentMuted: '#b67d09', // readable accent for small text on the light bg
  accent2: '#9d7be0', // lavender pop (also dropdown/menu surfaces)
  onAccent: '#3a2c14', // text colour that sits ON a filled accent
  textPrimary: '#3a2c14',
  textSecondary: '#6b5a3c',
  textMuted: '#9c8c6e',
  border: 'rgba(58,44,20,0.12)',
  borderAccent: 'rgba(240,168,24,0.45)',
  // dropdown/menu surfaces — pale lavender panel (mirrors web --menu-*)
  menuBg: '#f0eafb',
  menuText: '#3a2c14',
  menuHover: '#e3d5f6',
  menuBorder: 'rgba(157,123,224,0.5)',
  danger: '#d36363',
};

export type Palette = typeof lightColors;

export const darkColors: Palette = {
  bgPrimary: '#181613',
  bgSecondary: '#201d19',
  bgCard: '#26231e',
  bgCardHover: '#2f2b25',
  accent: '#f0a818',
  accentLight: '#ffc859',
  accentMuted: '#e0a836', // brightened — readable on dark
  accent2: '#b79bf0', // brightened lavender for dark
  onAccent: '#241d10', // dark text still sits on the bright gold
  textPrimary: '#f2ece0',
  textSecondary: '#cabfa9',
  textMuted: '#998f7d',
  border: 'rgba(242,236,224,0.12)',
  borderAccent: 'rgba(240,168,24,0.45)',
  // dropdowns — purple-tinted charcoal + lavender border (mirrors web --menu-*)
  menuBg: '#2b2436',
  menuText: '#f2ece0',
  menuHover: '#352b44',
  menuBorder: 'rgba(183,155,240,0.45)',
  danger: '#d36363',
};

// Back-compat default (light). Migrated screens use useTheme().colors instead.
export const colors = lightColors;

export const fonts = {
  display: 'Cinzel_500Medium', // PAWPAW KO wordmark + binder/deck names ONLY
  serif: 'Lora_700Bold', // UI chrome (was Cinzel — read too skinny)
  serifBold: 'Lora_700Bold',
  body: 'Lora_400Regular',
  bodyItalic: 'Lora_400Regular_Italic',
  bodyBold: 'Lora_700Bold',
};

export const radius = { sm: 4, lg: 8 };
