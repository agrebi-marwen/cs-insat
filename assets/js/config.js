// config.js - Centralized Supabase configuration
// Fetches credentials from Vercel serverless function (keeps API keys secret)
window.SUPABASE_CONFIG = null;
window.SUPABASE_CONFIG_READY = false;

async function loadSupabaseConfig() {
  try {
    // Keep configuration on the same origin as the page. This matters when
    // Vercel dev selects a port other than 3000 because another local service
    // is already listening there.
    const endpoint = '/api/config';

    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Config fetch failed: ${response.status}`);
    
    window.SUPABASE_CONFIG = await response.json();
    window.SUPABASE_CONFIG_READY = true;
  } catch (error) {
    alert('Configuration error. Please refresh the page.');
  }
}

// Wait for config to be ready before accessing it
window.waitForConfig = function() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (window.SUPABASE_CONFIG_READY) {
        clearInterval(checkInterval);
        resolve(window.SUPABASE_CONFIG);
      }
    }, 50);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve(null);
    }, 5000);
  });
};

// Load config immediately
loadSupabaseConfig();
