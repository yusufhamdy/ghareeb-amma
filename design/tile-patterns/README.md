# Tile patterns (Shade style)

60 images: `<palette>-<mode>-<n>.webp` where palette is def, lav, sun, neo, min; mode is day or night; n is 1 to 6. 360x360 px.

The six patterns are ONE family: same colored field, same fade into the surface, same rim light, same soft highlight and companion glow. Only the position and shape of the dark core changes. Do not add other pattern types.

Rules:
- A tile shows pattern `hash(id) % 6` (hash: `reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0, 7)`), where id is the word id or the surah number. The same item always has the same pattern. Never random per visit or per search.
- Text always sits on the calm bottom third of the image (it fades into the surface color). Label color is the theme text color.
- Surah tiles use `border-radius: 26px`, no border. Challenge day tiles use 16px.
- Share cards (2160x3840) and reel covers use the word pattern, re-rendered at full size with `render_tiles.py` (numpy + Pillow).
- `preview.html` shows all patterns per palette and mode.
