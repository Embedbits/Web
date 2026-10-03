import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import EmailReveal from '@site/src/components/EmailReveal';

export default function Contact(): ReactNode {
    return (
        <Layout
            title="Contact"
            description="Contact Embedbits"
        >
            <main className="container container--medium margin-vert--xl">
                <h1>Contact</h1>
                <p>
                    Get in touch regarding projects, collaboration, commercial
                    licensing or embedded software development.
                </p>

                <EmailReveal />

                <p>
                    GitHub:{' '}
                    <a href="https://github.com/Embedbits">
                        github.com/Embedbits
                    </a>
                </p>
                <p>
                    Contributions are welcome. Please open a pull request in the
                    relevant repository.
                </p>
            </main>
        </Layout>
    );
}
