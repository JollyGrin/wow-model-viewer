# Wowhead's Model Viewer (ZamModelViewer)

## Technology

- **Name**: ZamModelViewer (by ZAM Network / Wowhead)
- **Renderer**: Custom WebGL (NOT Three.js or Babylon.js)
- **Format**: Heavily minified JavaScript (`viewer.min.js`)
- **CDN**: `wow.zamimg.com`
- **Dependencies**: jQuery 3.x
- **Data format**: Pre-converted from WoW's binary M2/BLP into optimized JSON + binary served from their CDN (not raw game files)

## Asset CDN Patterns

```
# Viewer script (retail/live)
https://wow.zamimg.com/modelviewer/live/viewer/viewer.min.js

# Classic viewer path
https://wow.zamimg.com/modelviewer/classic/

# Item metadata
https://wow.zamimg.com/modelviewer/live/meta/armor/{slot}/{displayId}.json
https://wow.zamimg.com/modelviewer/live/meta/item/{displayId}.json

# Character model data
https://wow.zamimg.com/modelviewer/live/character/{race}/{gender}/model.json

# Textures (converted to web-friendly formats)
https://wow.zamimg.com/modelviewer/live/textures/{path}.png

# Item icons (we already use this)
https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg
```

The `CONTENT_PATH` variable controls the base URL: `//wow.zamimg.com/modelviewer/`

## Character Configuration

Characters are configured via JSON:
```json
{
    "type": 16,
    "contentPath": "//wow.zamimg.com/modelviewer/",
    "race": 1,
    "gender": 0,
    "skin": 0,
    "face": 0,
    "hairStyle": 1,
    "hairColor": 0,
    "facialStyle": 0,
    "items": [[1, 16922], [3, 16924], [5, 16926]]
}
```

The `items` array contains `[slotId, itemId]` pairs. The viewer handles the full resolution pipeline internally.

## Wowhead's Dressing Room

- **URL**: https://www.wowhead.com/classic/dressing-room
- Allows "try on" of items on any race/gender combination
- URL format supports pre-equipped items
- **Could potentially iframe this** as a fallback approach, but:
  - No API for controlling from outside
  - Wowhead ToS may restrict embedding
  - No control over styling/camera

## CORS Challenges

Wowhead's CDN (`wow.zamimg.com`) does NOT set `Access-Control-Allow-Origin` headers for third-party domains. This means:
- Direct browser fetch from our domain will fail with CORS errors
- **Solutions**:
  1. **Server-side proxy** (Next.js API route) -- our previous approach
  2. **bypass-cors-policies** Docker container (Miorey's tool)
  3. **Self-hosted assets** -- extract and host model data ourselves

### Proxy Implementation (Next.js API Route)
```typescript
// app/api/wowhead-proxy/[...path]/route.ts
export async function GET(request, { params }) {
  const path = params.path.join('/');
  const targetUrl = `https://wow.zamimg.com/${path}`;

  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Referer': 'https://www.wowhead.com/',
    },
  });

  const data = await response.arrayBuffer();
  return new Response(data, {
    headers: {
      'Content-Type': response.headers.get('Content-Type'),
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
```

## Display ID Resolution

When you tell the viewer to equip item 19019 (Thunderfury):

1. Viewer looks up item metadata (embedded in Wowhead's page data or fetched via CDN)
2. Resolves `displayId` from item data
3. Fetches model files for that displayId from CDN
4. Determines equipment slot -> which rendering approach (texture overlay, geoset switch, or model attachment)
5. Applies to character model

### Getting Display IDs

Options for obtaining displayId for our items:
1. **Wowhead page source**: Contains `displayId` in JavaScript data on each item page
2. **wow-classic-items npm package**: Scraped Wowhead data with structured JSON
3. **Turtle-WOW-DBC repo**: ItemDisplayInfo.dbc with ALL display IDs including Turtle WoW custom ones
4. **murlocvillage.com API**: `https://wotlk.murlocvillage.com/api/items` -- maps WotLK items to retail display IDs
5. **Scrape during our data pipeline**: Add displayId field when scraping item data

## wow-model-viewer npm Package Details

The `wow-model-viewer` package wraps ZamModelViewer for programmatic use:

### Classic WoW Configuration
```javascript
// Point to classic content (via your proxy)
window.CONTENT_PATH = 'http://localhost:3000/modelviewer/classic/'

// Disable WotLK-to-retail display ID API (not needed for classic)
window.WOTLK_TO_RETAIL_DISPLAY_ID_API = undefined

// Generate model
generateModels(1.5, '#model_3d', character, "classic")
```

### Equipment Format
```javascript
const character = {
  race: 1,        // Human
  gender: 0,      // Male
  skin: 0,
  face: 0,
  hairStyle: 1,
  hairColor: 0,
  facialStyle: 0,
  items: [
    [1, displayId],   // Head
    [3, displayId],   // Shoulder
    [5, displayId],   // Chest
    [6, displayId],   // Waist
    [7, displayId],   // Legs
    [8, displayId],   // Feet
    [9, displayId],   // Wrists
    [10, displayId],  // Hands
    [15, displayId],  // Back (cape)
    [16, displayId],  // Main Hand
    [17, displayId],  // Off Hand
    [19, displayId],  // Tabard
  ]
}
```

## Legal Considerations

- WoW model files are copyrighted by Blizzard Entertainment
- Wowhead's pre-processed data belongs to ZAM Network
- Using their CDN for personal/small projects is tolerated but not explicitly permitted
- For production: consider self-hosting extracted assets or building your own conversion pipeline
- The wow-model-viewer npm package is MIT licensed but depends on Wowhead's proprietary viewer

## Sources
- [Wowhead Model Viewer Help](https://www.wowhead.com/help=modelviewer)
- [Wowhead Classic Dressing Room](https://www.wowhead.com/classic/dressing-room)
- [wow-model-viewer GitHub](https://github.com/Miorey/wow-model-viewer)
- [bypass-cors-policies](https://github.com/Miorey/bypass-cors-policies)
- [wow-classic-items npm](https://www.npmjs.com/package/wow-classic-items)
