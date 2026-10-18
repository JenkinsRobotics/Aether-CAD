import { createRoot } from 'react-dom/client';
import { FeatureGallery } from './FeatureGallery';
import '@aether/ui/tokens.css';
import '@aether/ui/widgets.css';
createRoot(document.getElementById('root')!).render(<FeatureGallery embedded={new URLSearchParams(location.search).get('embed') === '1'} />);
