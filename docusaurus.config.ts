import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'EmbedBits',
  tagline: 'Embedded software engineering',
  favicon: 'img/logo.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://embedbits.github.io',
  baseUrl: '/Web/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'Embedbits',
  projectName: 'Web',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    // *.md is parsed as plain CommonMark (READMEs synced from other repositories
    // contain raw <, { and HTML), *.mdx is parsed as MDX.
    format: 'detect',
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Embedbits/Web/tree/main/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/Embedbits/Web/tree/main/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  customFields: {
    // Contact form (src/components/ContactForm.tsx), see README "Contact form".
    // Both values are public by design; leave them empty to show the plain e-mail link instead.
    contactForm: {
      web3formsAccessKey: 'c9fe390c-5b30-44ba-9b02-e6268c36acb9',
      turnstileSiteKey: '0x4AAAAAAFNAVWFYgqIsfGXz',
    },
  },

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
        title: 'Embedbits',
        logo: {
            alt: 'Embedbits',
            src: 'img/logo.svg',
        },
        items: [
            {
                to: '/projects',
                label: 'Projects',
                position: 'left',
            },
            {
                to: '/docs/intro',
                label: 'Documentation',
                position: 'left',
            },
            {
                to: '/blog',
                label: 'Articles',
                position: 'left',
            },
            {
                to: '/about',
                label: 'About',
                position: 'left',
            },
            {
                href: 'https://github.com/Embedbits',
                label: 'GitHub',
                position: 'right',
            },
        ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {label: 'Introduction', to: '/docs/intro'},
            {label: 'Platform', to: '/docs/platform/embi-platform'},
            {label: 'BSP', to: '/docs/bsp'},
            {label: 'Artifacts', to: '/docs/artifacts'},
          ],
        },
        {
          title: 'Embedbits',
          items: [
            {label: 'Projects', to: '/projects'},
            {label: 'Articles', to: '/blog'},
            {label: 'About', to: '/about'},
            {label: 'Contact', to: '/contact'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/Embedbits'},
            {label: 'This website', href: 'https://github.com/Embedbits/Web'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Embedbits. Built with Docusaurus.`,
    },
    prism: {
        additionalLanguages: [
            'c',
            'cpp',
            'bash',
            'cmake',
            'yaml',
            'ini',
            'diff',
        ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
