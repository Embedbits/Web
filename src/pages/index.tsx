import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import styles from './index.module.css';

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

function ProjectCard({project}: {project: Project}): ReactNode {
    return (
        <Link className={styles.projectCard} to={project.href}>
            <h3>{project.name}</h3>
            <p>{project.description}</p>
            <span>Explore project →</span>
        </Link>
    );
}

export default function Home(): ReactNode {
    return (
        <Layout
            title="Embedded software engineering"
            description="Embedded software engineering, projects, documentation and articles."
        >
            <main>
                <section className={styles.hero}>
                    <div className={styles.heroInner}>
                        <div className={styles.eyebrow}>
                            EMBEDDED SOFTWARE ENGINEERING
                        </div>

                        <h1>
                            Building embedded software
                            <br />
                            <span>without unnecessary complexity.</span>
                        </h1>

                        <p className={styles.heroDescription}>
                            Reusable embedded software projects, engineering
                            documentation and practical articles covering
                            architecture, STM32, tooling, testing and
                            development infrastructure.
                        </p>

                        <div className={styles.heroActions}>
                            <Link
                                className={clsx(
                                    'button',
                                    'button--primary',
                                    styles.primaryButton,
                                )}
                                to="/projects"
                            >
                                Explore projects
                            </Link>

                            <Link
                                className={clsx(
                                    'button',
                                    'button--secondary',
                                    styles.secondaryButton,
                                )}
                                to="/blog"
                            >
                                Read articles
                            </Link>
                        </div>
                    </div>
                </section>

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <div className={styles.sectionEyebrow}>
                                OPEN SOURCE & ENGINEERING
                            </div>
                            <h2>Projects</h2>
                        </div>

                        <Link to="/projects" className={styles.viewAll}>
                            View all →
                        </Link>
                    </div>

                    <div className={styles.projectGrid}>
                        {projects.map((project) => (
                            <ProjectCard
                                key={project.name}
                                project={project}
                            />
                        ))}
                    </div>
                </section>

                <section className={styles.featureSection}>
                    <div className={styles.feature}>
                        <div className={styles.featureNumber}>01</div>
                        <div>
                            <h3>Documentation</h3>
                            <p>
                                Architecture, configuration and practical
                                guides for embedded software projects.
                            </p>
                            <Link to="/docs/intro">
                                Browse documentation →
                            </Link>
                        </div>
                    </div>

                    <div className={styles.feature}>
                        <div className={styles.featureNumber}>02</div>
                        <div>
                            <h3>Articles</h3>
                            <p>
                                Practical notes about embedded C, STM32,
                                software architecture, build systems and
                                development tools.
                            </p>
                            <Link to="/blog">Read articles →</Link>
                        </div>
                    </div>

                    <div className={styles.feature}>
                        <div className={styles.featureNumber}>03</div>
                        <div>
                            <h3>Engineering</h3>
                            <p>
                                Focused on maintainable software, reproducible
                                builds, testing and reusable infrastructure.
                            </p>
                            <Link to="/about">About Embedbits →</Link>
                        </div>
                    </div>
                </section>
            </main>
        </Layout>
    );
}