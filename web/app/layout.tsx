// ---
// 📚 POR QUÉ: Root layout del dashboard web. Configura el HTML base, metadatos SEO,
//    fuentes, y estilos globales. Sin un layout raíz bien configurado, cada página
//    tendría que repetir head, meta tags y font loading — violando DRY.
// 📁 ARCHIVO: web/app/layout.tsx
// ---

import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

export const metadata: Metadata = {
  title: 'ALLO — Adaptive Landslide Learning Observatory',
  description:
    'Stochastic and agentic monitoring for climate-related landslide risk.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen antialiased bg-obsidian-bg text-obsidian-on-surface">
        <div className="grid-bg" />
        <div className="glow-tr" />
        <LanguageProvider>
          <div className="relative z-10">
            {children}
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
