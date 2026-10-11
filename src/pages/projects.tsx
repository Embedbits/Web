import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Translate, {translate} from '@docusaurus/Translate';

import styles from './projects.module.css';

type Project = {
    name: string;
    description: string;
    href: string;
};

const projects: Project[] = [
    {
        name: 'EmBi_Platform',
        description: translate({
            id: 'projects.platform.description',
            message:
                'Setup scripts, CMake helpers, STM32CubeIDE templates and updater that tie a project together.',
        }),
        href: '/docs/platform/embi-platform',
    },
    {
        name: 'BSP',
        description: translate({
            id: 'projects.bsp.description',
            message:
                'Board Support Package with one branch per STM32 family: linker, startup, RAL and MCAL.',
        }),
        href: '/docs/bsp',
    },
    {
        name: 'RAL',
        description: translate({
            id: 'projects.ral.description',
            message:
                'Register abstraction layer around CMSIS and STM32 LL for a unified low-level interface.',
        }),
        href: '/docs/bsp/ral',
    },
    {
        name: 'MCAL',
        description: translate({
            id: 'projects.mcal.description',
            message:
                'Peripheral drivers with a consistent API: GPIO, USART, I2C, ADC, DMA, NVIC, TIM and more.',
        }),
        href: '/docs/bsp/mcal',
    },
    {
        name: 'Artifacts',
        description: translate({
            id: 'projects.artifacts.description',
            message:
                'Versioned build tools such as GCC, Ninja, Doxygen, Unity, CMock and Renode, fetched automatically.',
        }),
        href: '/docs/artifacts',
    },
];

export default function Projects(): ReactNode {
    return (
        <Layout
            title={translate({id: 'projects.title', message: 'Projects'})}
            description={translate({id: 'projects.metaDescription', message: 'Embedbits embedded software projects.'})}
        >
            <main className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.eyebrow}>
                        <Translate id="projects.eyebrow">EMBEDBITS PROJECTS</Translate>
                    </div>

                    <h1><Translate id="projects.heading">Projects</Translate></h1>

                    <p>
                        <Translate id="projects.intro">
                            Reusable software components and development
                            infrastructure for embedded systems.
                        </Translate>
                    </p>
                </header>

                <div className={styles.grid}>
                    {projects.map((project) => (
                        <Link
                            key={project.name}
                            className={styles.card}
                            to={project.href}
                        >
                            <h2>{project.name}</h2>
                            <p>{project.description}</p>
                            <span><Translate id="projects.explore">Explore →</Translate></span>
                        </Link>
                    ))}
                </div>
            </main>
        </Layout>
    );
}