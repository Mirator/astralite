import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const title = 'The Drowned Keep';
const description =
  'Explore a procedural drowned fortress in an atmospheric isometric dungeon adventure.';

export const metadata: Metadata = {
  title,
  description,
  // Hrefs are document-relative on purpose. vinext emits icon hrefs verbatim,
  // and GitHub Pages serves this project from a repository sub-path, so a
  // root-absolute href (which is what the `app/icon.*` file convention emits)
  // would resolve outside the deployment. The SVG is the icon; the PNG is the
  // fallback for Safari < 16 and other engines without SVG favicon support.
  icons: {
    icon: [
      { url: './favicon.svg', type: 'image/svg+xml', sizes: 'any' },
      { url: './favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
  },
  // No `openGraph.images` / `twitter.images`: the repository ships no share
  // image, and Open Graph image URLs must be absolute — there is no confirmed
  // production origin here to build one from. A title-and-description card
  // beats a card pointing at a missing file.
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: title,
    title,
    description,
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
