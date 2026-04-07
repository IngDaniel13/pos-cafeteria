// ============================================================
// CONFIGURACIÓN - Supabase + Cloudinary
// ============================================================

const CONFIG = {
  supabase: {
    url: 'https://zmzyuccvlegklwohfjvp.supabase.co',          
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptenl1Y2N2bGVna2x3b2hmanZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTQ3MDIsImV4cCI6MjA4NjU3MDcwMn0.VZBwzl2ZFwB_SJRBQo_qxBNkVF7OOyrP_-9wi6LskTM'                         // ← Reemplaza
  },
  cloudinary: {
    cloudName: 'duuletuej',                        
    uploadPreset: 'pos_cafeteria_preset'                
  }
};

// Inicializar cliente de Supabase
const supabaseClient = supabase.createClient(
  CONFIG.supabase.url,
  CONFIG.supabase.anonKey
);

// Función helper para subir imagen a Cloudinary
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CONFIG.cloudinary.uploadPreset);
  formData.append('folder', 'pos-cafeteria/products');

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!response.ok) throw new Error('Error al subir imagen a Cloudinary');
  const data = await response.json();
  return data.secure_url;
}
