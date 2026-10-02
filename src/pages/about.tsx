import type {ReactNode} from 'react';
import Layout from '@theme/Layout';

export default function About(): ReactNode {
    return (
        <Layout
            title="About"
            description="About Embedbits."
        >
            <main className="container container--medium margin-vert--xl">
                <h1>About Embedbits</h1>

                <p>
                    Embedbits is focused on embedded software engineering,
                    reusable software infrastructure and practical engineering
                    knowledge.
                </p>

                <p>
                    The goal is to make embedded development more maintainable,
                    reproducible and easier to understand.
                </p>

                <h2>Focus areas</h2>

                <ul>
                    <li>Embedded C and C++</li>
                    <li>STM32</li>
                    <li>Software architecture</li>
                    <li>Build systems and CMake</li>
                    <li>Testing and CI</li>
                    <li>Development tooling</li>
                </ul>
            </main>
        </Layout>
    );
}