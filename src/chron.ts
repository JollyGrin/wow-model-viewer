import { setAssetBase, setAssetAuth } from './assetBase';

// Load all models and textures from the Chronicle CDN
setAssetBase('https://models.chronicleclassic.com');

// Set auth from env var (VITE_ prefix exposes it to client via import.meta.env)
const authToken = import.meta.env.VITE_CHRONICLE_AUTH;
if (authToken) {
  setAssetAuth(authToken);
}

// Dynamically import main — config runs first since static imports
// resolve before dynamic ones, and our calls are synchronous above.
import('./main');
