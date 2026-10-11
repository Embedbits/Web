import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Translate, {translate} from '@docusaurus/Translate';

export default function About(): ReactNode {
    return (
        <Layout
            title={translate({id: 'about.title', message: 'About'})}
            description={translate({
                id: 'about.metaDescription',
                message: 'About Embedbits: reusable, well-documented building blocks for maintainable STM32 development.',
            })}
        >
            <main className="container container--medium margin-vert--xl">
                <h1><Translate id="about.heading">About Embedbits</Translate></h1>

                <p>
                    <Translate id="about.intro">
                        Embedbits is a collection of embedded software projects,
                        tools and articles focused on maintainable STM32
                        development. It started as a personal answer to a
                        familiar problem: every project ends up with its own
                        build scripts, its own drivers and its own way of doing
                        things. Embedbits tries to turn that into reusable,
                        well-documented building blocks.
                    </Translate>
                </p>

                <h2><Translate id="about.who.heading">Who is behind it</Translate></h2>

                <p>
                    <Translate id="about.who.text">
                        I'm Mr.Nobody, an embedded software engineer with a
                        background in the automotive industry. The coding style,
                        the state machine template and many of the architecture
                        ideas here come from real projects, then simplified and
                        published as open source. The licence of each project is
                        stated in its repository.
                    </Translate>
                </p>

                <h2><Translate id="about.find.heading">What you will find here</Translate></h2>

                <ul>
                    <li>
                        <strong>
                            <Link to="/projects">
                                <Translate id="about.find.projects">Projects</Translate>
                            </Link>
                        </strong>{' '}
                        –{' '}
                        <Translate id="about.find.projects.text">
                            EmBi_Platform, the BSP (RAL and MCAL) and Artifacts,
                            the build tools fetched automatically.
                        </Translate>
                    </li>
                    <li>
                        <strong>
                            <Link to="/docs/intro">
                                <Translate id="about.find.docs">Documentation</Translate>
                            </Link>
                        </strong>{' '}
                        –{' '}
                        <Translate id="about.find.docs.text">
                            the READMEs of all repositories in one place,
                            including which STM32 families each module supports.
                        </Translate>
                    </li>
                    <li>
                        <strong>
                            <Link to="/blog">
                                <Translate id="about.find.articles">Articles</Translate>
                            </Link>
                        </strong>{' '}
                        –{' '}
                        <Translate id="about.find.articles.text">
                            notes about software architecture, state machines
                            and embedded C.
                        </Translate>
                    </li>
                </ul>

                <h2><Translate id="about.principles.heading">Principles</Translate></h2>

                <ul>
                    <li><Translate id="about.principles.1">Readable code beats clever code.</Translate></li>
                    <li><Translate id="about.principles.2">One module, one responsibility, one interface.</Translate></li>
                    <li>
                        <Translate id="about.principles.3">
                            Reproducible builds: the same project builds the
                            same way on every machine.
                        </Translate>
                    </li>
                    <li>
                        <Translate id="about.principles.4">
                            If it can be tested, it should be.
                        </Translate>
                    </li>
                </ul>

                <h2><Translate id="about.contact.heading">Get in touch</Translate></h2>

                <p>
                    <Translate
                        id="about.contact.text"
                        values={{
                            contact: (
                                <Link to="/contact">
                                    <Translate id="about.contact.link">Contact</Translate>
                                </Link>
                            ),
                            github: <a href="https://github.com/Embedbits">GitHub</a>,
                        }}
                    >
                        {'See the {contact} page or visit {github}.'}
                    </Translate>
                </p>
            </main>
        </Layout>
    );
}
