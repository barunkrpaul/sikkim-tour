/** Build the stylesheet with: npm install && npm run build:css */
module.exports = {
  content: ['./index.html', './assets/app.js'],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: '#173F35', light: '#24584B', dark: '#0F2B24' },
        himalaya: { DEFAULT: '#547C91', dark: '#3B5F71' },
        ivory: '#FAF8F2',
        amber: { DEFAULT: '#D8A84E', dark: '#7D5A16' },
        charcoal: '#252B2A'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif']
      }
    }
  }
};
