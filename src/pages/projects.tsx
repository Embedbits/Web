import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import styles from './projects.module.css';

type Project = {
    name: string;
    description: string;
    href: string;
};

const projects: Project[] = [
    {
        name: 'STM Template',
        description:
            'Reusable infrastructure for embedded software projects based on CMake, STM32, host testing and CI.',
        href: '/docs/projects/stm-template/overview',
    },
    {
        name: 'EmBi_Platform',
        description:
            'Setup scripts, CMake helpers, STM32CubeIDE templates and updater that tie a project together.',
        href: '/docs/platform/embi-platform',
    },
    {
        name: 'BSP',
        description:
            'Board Support Package with one branch per STM32 family: linker, startup, RAL and MCAL.',
        href: '/docs/bsp/overview',
    },
    {
        name: 'RAL',
        description:
            'Register abstraction layer around CMSIS and STM32 LL for a unified low-level interface.',
        href: '/docs/bsp/ral/overview',
    },
    {
        name: 'MCAL',
        description:
            'Peripheral drivers with a consistent API: GPIO, USART, I2C, ADC, DMA, NVIC, TIM and more.',
        href: '/docs/bsp/mcal/overview',
    },
    {
        name: 'Artifacts',
        description:
            'Versioned build tools such as GCC, Ninja, Doxygen, Unity, CMock and Renode, fetched automatically.',
        href: '/docs/artifacts/overview',
    },
];

export default function Projects(): ReactNode {
    return (
        <Layout
            title="Projects"
            description="Embedbits embedded software projects."
        >
            <main className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.eyebrow}>
                        EMBEDBITS PROJECTS
                    </div>

                    <h1>Projects</h1>

                    <p>
                        Reusable software components and development
                        infrastructure for embedded systems.
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
                            <span>Explore →</span>
                        </Link>
                    ))}
                </div>
            </main>
        </Layout>
    );
}