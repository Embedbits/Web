import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

export default function About(): ReactNode {
    return (
        <Layout
            title="About"
            description="About Embedbits: reusable, well-documented building blocks for maintainable STM32 development."
        >
            <main className="container container--medium margin-vert--xl">
                <h1>About Embedbits</h1>

                <p>
                    Embedbits is a collection of embedded software projects,
                    tools and articles focused on maintainable STM32
                    development. It started as a personal answer to a familiar
                    problem: every project ends up with its own build scripts,
                    its own drivers and its own way of doing things. Embedbits
                    tries to turn that into reusable, well-documented building
                    blocks.
                </p>

                <h2>Who is behind it</h2>

                <p>
                    I'm Mr.Nobody, an embedded software engineer with a
                    background in the automotive industry. The coding style,
                    the state machine template and many of the architecture
                    ideas here come from real projects, then simplified and
                    published as open source. The licence of each project is
                    stated in its repository.
                </p>

                <h2>What you will find here</h2>

                <ul>
                    <li>
                        <strong>
                            <Link to="/projects">Projects</Link>
                        </strong>{' '}
                        – EmBi_Platform, the BSP (RAL and MCAL) and Artifacts,
                        the build tools fetched automatically.
                    </li>
                    <li>
                        <strong>
                            <Link to="/docs/intro">Documentation</Link>
                        </strong>{' '}
                        – the READMEs of all repositories in one place,
                        including which STM32 families each module supports.
                    </li>
                    <li>
                        <strong>
                            <Link to="/blog">Articles</Link>
                        </strong>{' '}
                        – notes about software architecture, state machines and
                        embedded C.
                    </li>
                </ul>

                <h2>Principles</h2>

                <ul>
                    <li>Readable code beats clever code.</li>
                    <li>One module, one responsibility, one interface.</li>
                    <li>
                        Reproducible builds: the same project builds the same
                        way on every machine.
                    </li>
                    <li>If it can be tested, it should be.</li>
                </ul>

                <h2>Get in touch</h2>

                <p>
                    See the <Link to="/contact">Contact</Link> page or visit{' '}
                    <a href="https://github.com/Embedbits">GitHub</a>.
                </p>
            </main>
        </Layout>
    );
}
