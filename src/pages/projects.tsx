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
            'Reusable STM32 embedded software project infrastructure based on CMake, host testing and CI.',
        href: '/docs/projects/stm-template/overview',
    },
    {
        name: 'BSP',
        description:
            'Board Support Package components and architecture for embedded projects.',
        href: '#',
    },
    {
        name: 'RAL',
        description:
            'Register and low-level hardware abstraction around vendor libraries and CMSIS.',
        href: '#',
    },
    {
        name: 'MCAL',
        description:
            'Microcontroller abstraction components for reusable embedded software stacks.',
        href: '#',
    },
    {
        name: 'Middlewares',
        description:
            'Reusable middleware components for common embedded application infrastructure.',
        href: '#',
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