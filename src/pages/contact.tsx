import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Translate, {translate} from '@docusaurus/Translate';
import EmailReveal from '@site/src/components/EmailReveal';

export default function Contact(): ReactNode {
    return (
        <Layout
            title={translate({id: 'contact.title', message: 'Contact'})}
            description={translate({id: 'contact.metaDescription', message: 'Contact Embedbits'})}
        >
            <main className="container container--medium margin-vert--xl">
                <h1><Translate id="contact.heading">Contact</Translate></h1>
                <p>
                    <Translate id="contact.intro">
                        Get in touch regarding projects, collaboration,
                        commercial licensing or embedded software development.
                    </Translate>
                </p>

                <EmailReveal />

                <p>
                    GitHub:{' '}
                    <a href="https://github.com/Embedbits">
                        github.com/Embedbits
                    </a>
                </p>
                <p>
                    <Translate id="contact.contributions">
                        Contributions are welcome. Please open a pull request in
                        the relevant repository.
                    </Translate>
                </p>
            </main>
        </Layout>
    );
}
