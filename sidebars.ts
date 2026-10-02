import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
    tutorialSidebar: [
        'intro',
        {
            type: 'category',
            label: 'Projects',
            items: [
                {
                    type: 'category',
                    label: 'STM Template',
                    items: [
                        'projects/stm-template/overview',
                        'projects/stm-template/architecture',
                        'projects/stm-template/getting-started',
                        'projects/stm-template/testing',
                    ],
                },
            ],
        },
    ],
};

export default sidebars;