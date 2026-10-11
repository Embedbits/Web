import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Translate, {translate} from '@docusaurus/Translate';

import styles from './index.module.css';

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

function ProjectCard({project}: {project: Project}): ReactNode {
    return (
        <Link className={styles.projectCard} to={project.href}>
            <h3>{project.name}</h3>
            <p>{project.description}</p>
            <span><Translate id="home.exploreProject">Explore project →</Translate></span>
        </Link>
    );
}

export default function Home(): ReactNode {
    return (
        <Layout
            title={translate({id: 'home.title', message: 'Embedded software engineering'})}
            description={translate({
                id: 'home.metaDescription',
                message: 'Embedded software engineering, projects, documentation and articles.',
            })}
        >
            <main>
                <section className={styles.hero}>
                    <div className={styles.heroInner}>
                        <div className={styles.eyebrow}>
                            <Translate id="home.eyebrow">
                                EMBEDDED SOFTWARE ENGINEERING
                            </Translate>
                        </div>

                        <h1>
                            <Translate id="home.headline1">
                                Building embedded software
                            </Translate>
                            <br />
                            <span>
                                <Translate id="home.headline2">
                                    without unnecessary complexity.
                                </Translate>
                            </span>
                        </h1>

                        <p className={styles.heroDescription}>
                            <Translate id="home.description">
                                Reusable embedded software projects, engineering
                                documentation and practical articles covering
                                architecture, STM32, tooling, testing and
                                development infrastructure.
                            </Translate>
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
                                <Translate id="home.exploreProjects">Explore projects</Translate>
                            </Link>

                            <Link
                                className={clsx(
                                    'button',
                                    'button--secondary',
                                    styles.secondaryButton,
                                )}
                                to="/blog"
                            >
                                <Translate id="home.readArticles">Read articles</Translate>
                            </Link>
                        </div>
                    </div>
                </section>

                <section className={styles.motto}>
                    <blockquote>
                        <span>
                            <Translate id="home.motto1">
                                Always write your code, as if the guy, who ends
                                up maintaining your code,
                            </Translate>
                        </span>{' '}
                        <span>
                            <Translate id="home.motto2">
                                will be a violent psychopath who knows where you
                                live.
                            </Translate>
                        </span>
                    </blockquote>
                </section>

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <div className={styles.sectionEyebrow}>
                                <Translate id="home.sectionEyebrow">OPEN SOURCE & ENGINEERING</Translate>
                            </div>
                            <h2><Translate id="home.projects">Projects</Translate></h2>
                        </div>

                        <Link to="/projects" className={styles.viewAll}>
                            <Translate id="home.viewAll">View all →</Translate>
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
                            <h3><Translate id="home.feature1.title">Documentation</Translate></h3>
                            <p>
                                <Translate id="home.feature1.text">
                                    Architecture, configuration and practical
                                    guides for embedded software projects.
                                </Translate>
                            </p>
                            <Link to="/docs/intro">
                                <Translate id="home.feature1.link">Browse documentation →</Translate>
                            </Link>
                        </div>
                    </div>

                    <div className={styles.feature}>
                        <div className={styles.featureNumber}>02</div>
                        <div>
                            <h3><Translate id="home.feature2.title">Articles</Translate></h3>
                            <p>
                                <Translate id="home.feature2.text">
                                    Practical notes about embedded C, STM32,
                                    software architecture, build systems and
                                    development tools.
                                </Translate>
                            </p>
                            <Link to="/blog">
                                <Translate id="home.feature2.link">Read articles →</Translate>
                            </Link>
                        </div>
                    </div>

                    <div className={styles.feature}>
                        <div className={styles.featureNumber}>03</div>
                        <div>
                            <h3><Translate id="home.feature3.title">Engineering</Translate></h3>
                            <p>
                                <Translate id="home.feature3.text">
                                    Focused on maintainable software,
                                    reproducible builds, testing and reusable
                                    infrastructure.
                                </Translate>
                            </p>
                            <Link to="/about">
                                <Translate id="home.feature3.link">About Embedbits →</Translate>
                            </Link>
                        </div>
                    </div>
                </section>
            </main>
        </Layout>
    );
}