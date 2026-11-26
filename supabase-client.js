window.createRestaurantClient = async function createRestaurantClient(options = {}) {
  const config = window.BUKE_ZEMER_BACKEND;
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) return null;
  if (!["http:", "https:"].includes(window.location.protocol)) {
    throw new Error("Supabase kërkon që faqja të hapet përmes HTTP ose HTTPS.");
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: !options.publicOnly,
      autoRefreshToken: !options.publicOnly,
      detectSessionInUrl: !options.publicOnly
    }
  });
};
