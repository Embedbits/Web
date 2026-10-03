import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

type Turnstile = {
    render: (el: HTMLElement, options: {sitekey: string; callback: () => void}) => string;
};

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// The address is not written out in the source, so simple scrapers do not find it.
const ENCODED_EMAIL = 'bm9ib2R5QGVtYmVkYml0cy5jb20=';

/**
 * Shows the contact e-mail address only after the visitor passes a Cloudflare
 * Turnstile check. The check runs in the browser, which keeps harvesting bots
 * away but is not a server-side guarantee.
 */
export default function EmailReveal(): ReactNode {
    const {siteConfig} = useDocusaurusContext();
    const siteKey = siteConfig.customFields?.turnstileSiteKey as string | undefined;
    const [email, setEmail] = useState('');
    const widget = useRef<HTMLDivElement>(null);
    const rendered = useRef(false);

    useEffect(() => {
        if (!siteKey || !widget.current) return;
        const render = () => {
            const turnstile = (window as unknown as {turnstile?: Turnstile}).turnstile;
            if (!turnstile || !widget.current || rendered.current) return;
            rendered.current = true;
            turnstile.render(widget.current, {sitekey: siteKey, callback: () => setEmail(atob(ENCODED_EMAIL))});
        };
        if ((window as unknown as {turnstile?: Turnstile}).turnstile) {
            render();
            return;
        }
        let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
        if (!script) {
            script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT;
            script.async = true;
            document.head.appendChild(script);
        }
        script.addEventListener('load', render);
        return () => script?.removeEventListener('load', render);
    }, [siteKey]);

    if (email) {
        return (
            <p>
                Email: <a href={`mailto:${email}`}>{email}</a>
            </p>
        );
    }

    return (
        <>
            <p>Please confirm that you are human to see the e-mail address.</p>
            <div ref={widget} />
            <noscript>
                <p>JavaScript is required to show the e-mail address.</p>
            </noscript>
        </>
    );
}
