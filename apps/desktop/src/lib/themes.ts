export type ThemeMode = 'dark' | 'light' | 'system'
type Palette = { id: string; name: string; background: string; foreground: string; accent: string; lightBackground: string }

// App adaptations of the reference styles; mode and palette are independent.
export const themePresets: Palette[] = [
  { id: 'default', name: 'AXCrew', background: '#171a20', foreground: '#e7e9ef', accent: '#b3a4f7', lightBackground: '#f6f5f9' },
  ...([
    ['chatgpt', 'ChatGPT', '#181818', '#ffffff', '#60a5fa', '#f7f7f7'],
    ['absolutely', 'Absolutely', '#242321', '#eee8df', '#d99070', '#faf4ed'],
    ['ayu', 'Ayu', '#0b0e14', '#bfbdb6', '#ffb454', '#faf8f2'],
    ['catppuccin', 'Catppuccin', '#1e1e2e', '#cdd6f4', '#cba6f7', '#eff1f5'],
    ['dracula', 'Dracula', '#282a36', '#f8f8f2', '#ff79c6', '#f8f4fa'],
    ['everforest', 'Everforest', '#2d353b', '#d3c6aa', '#a7c080', '#fdf6e3'],
    ['github', 'GitHub', '#0d1117', '#e6edf3', '#58a6ff', '#ffffff'],
    ['gruvbox', 'Gruvbox', '#282828', '#ebdbb2', '#8ec07c', '#fbf1c7'],
    ['linear', 'Linear', '#17171c', '#eeeeF0', '#9b96ff', '#f7f7fa'],
    ['lobster', 'Lobster', '#101923', '#e8edf3', '#ff7777', '#fff5f2'],
    ['material', 'Material', '#263238', '#eeffff', '#80cbc4', '#f5faf9'],
    ['matrix', 'Matrix', '#050b07', '#b6f5c2', '#00e676', '#f0faf2'],
    ['monokai', 'Monokai', '#272822', '#f8f8f2', '#e6db74', '#faf8ee'],
    ['night-owl', 'Night Owl', '#011627', '#d6deeb', '#82aaff', '#f4f8fc'],
    ['nord', 'Nord', '#2e3440', '#eceff4', '#88c0d0', '#eceff4'],
    ['notion', 'Notion', '#191919', '#e6e6e4', '#67a9e8', '#ffffff'],
    ['og', 'OG', '#202123', '#ececf1', '#46cba4', '#f5faf8'],
    ['one', 'One', '#282c34', '#abb2bf', '#61afef', '#fafafa'],
    ['oscurange', 'Oscurange', '#111111', '#ece5de', '#ffb078', '#fff7ef'],
    ['raycast', 'Raycast', '#171717', '#f0f0f0', '#ff6363', '#fff6f6'],
    ['rose-pine', 'Rose Pine', '#191724', '#e0def4', '#ebbcba', '#faf4ed'],
    ['sentry', 'Sentry', '#211b2e', '#eee6f4', '#b79aff', '#f7f3fc'],
    ['solarized', 'Solarized', '#002b36', '#93a1a1', '#2aa198', '#fdf6e3'],
    ['temple', 'Temple', '#071a12', '#e3eed3', '#c6df45', '#f7faeb'],
    ['tokyo-night', 'Tokyo Night', '#1a1b26', '#c0caf5', '#7aa2f7', '#f0f1f7'],
    ['vercel', 'Vercel', '#000000', '#ededed', '#70b8ff', '#ffffff'],
    ['vs-code-plus', 'VS Code Plus', '#1e1e1e', '#d4d4d4', '#4db6f2', '#f7f9fc'],
    ['xcode', 'Xcode', '#1f1f24', '#dfdfe0', '#89a7ff', '#fafafa'],
  ].map(([id, name, background, foreground, accent, lightBackground]) => ({ id, name, background, foreground, accent, lightBackground }))),
]

export function getThemePreset(id: string) {
  return themePresets.find(preset => preset.id === id) ?? themePresets[0]
}

function mix(a: string, b: string, weight: number) {
  const channels = [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - weight) + parseInt(b.slice(offset, offset + 2), 16) * weight).toString(16).padStart(2, '0'))
  return `#${channels.join('')}`
}

export function themeColors(id: string, mode: 'dark' | 'light') {
  const preset = getThemePreset(id)
  const light = mode === 'light'
  const background = light ? preset.lightBackground : preset.background
  const foreground = light ? '#292a30' : preset.foreground
  const accent = light ? mix(preset.accent, '#000000', .5) : preset.accent
  return { background, foreground, accent,
    panel: mix(background, light ? '#ffffff' : foreground, light ? .55 : .04),
    muted: mix(background, foreground, .67), border: mix(background, foreground, .19),
    hover: mix(background, foreground, .09), active: mix(background, foreground, .15),
    strong: mix(preset.accent, '#000000', .48), strongHover: mix(preset.accent, '#000000', .4),
  }
}

export function applyTheme(root: HTMLElement, mode: 'dark' | 'light', presetId: string) {
  root.dataset.theme = mode
  const preset = getThemePreset(presetId)
  root.dataset.palette = preset.id
  const c = themeColors(preset.id, mode)
  const tokens: Record<string, string> = {
    'color-surface': c.background, 'color-surface-raised': c.panel, 'color-foreground': c.foreground,
    'color-muted': c.muted, 'color-border': c.border, 'color-hover': c.hover, 'color-active': c.active,
    'color-accent': c.strong, 'color-accent-hover': c.strongHover, 'color-accent-text': c.accent,
    'shell-bg': c.background, 'shell-panel': c.panel, 'shell-input': c.panel, 'shell-text': c.foreground,
    'shell-muted': c.muted, 'shell-border': c.border, 'shell-hover': c.hover, 'shell-active': c.active,
    'shell-accent': c.accent, 'shell-accent-strong': c.strong, 'shell-accent-strong-hover': c.strongHover,
  }
  for (const [key, value] of Object.entries(tokens)) {
    if (preset.id === 'default') root.style.removeProperty(`--${key}`)
    else root.style.setProperty(`--${key}`, value)
  }
}
