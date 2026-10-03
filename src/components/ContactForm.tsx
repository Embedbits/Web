import {useEffect, useRef, useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import styles from './ContactForm.module.css';

type Status = 'idle' | 'sending' | 'sent' | 'error';

type Turnstile = {
    render: (el: HTMLElement, options: {sitekey: string; callback: (token: string) => void}) => string;
    reset: (id?: string) => void;
};

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Contact form that sends the message through Web3Forms, so the e-mail address
 * of the owner never appears on the page. Spam protection: a hidden honeypot
 * field and Cloudflare Turnstile (verified by Web3Forms, see the dashboard).
 */
export default function ContactForm({fallback}: {fallback: ReactNode}): ReactNode {
    const {siteConfig} = useDocusaurusContext();
    const {web3formsAccessKey, turnstileSiteKey} = (siteConfig.customFields?.contactForm ?? {}) as {
        web3formsAccessKey?: string;
        turnstileSiteKey?: string;
    };
    const [status, setStatus] = useState<Status>('idle');
    const [token, setToken] = useState('');
    const widget = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!turnstileSiteKey || !widget.current) return;
        const render = () => {
            const turnstile = (window as unknown as {turnstile?: Turnstile}).turnstile;
            if (!turnstile || !widget.current || widgetId.current) return;
            widgetId.current = turnstile.render(widget.current, {sitekey: turnstileSiteKey, callback: setToken});
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
    }, [turnstileSiteKey]);

    // Not configured yet: show the plain contact details.
    if (!web3formsAccessKey) return <>{fallback}</>;

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        if (data.get('botcheck')) return; // honeypot filled in: a bot
        if (turnstileSiteKey && !token) {
            setStatus('error');
            return;
        }
        setStatus('sending');
        try {
            const response = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({
                    access_key: web3formsAccessKey,
                    subject: 'Message from embedbits.com',
                    from_name: 'Embedbits website',
                    name: data.get('name'),
                    email: data.get('email'),
                    message: data.get('message'),
                    'cf-turnstile-response': token,
                }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message ?? 'request failed');
            form.reset();
            setStatus('sent');
        } catch {
            setStatus('error');
        } finally {
            setToken('');
            const turnstile = (window as unknown as {turnstile?: Turnstile}).turnstile;
            if (turnstile && widgetId.current) turnstile.reset(widgetId.current);
        }
    }

    if (status === 'sent') {
        return (
            <div className="alert alert--success" role="status">
                Thank you, your message has been sent.
            </div>
        );
    }

    return (
        <form className={styles.form} onSubmit={onSubmit}>
            <label>
                Name
                <input type="text" name="name" required maxLength={100} autoComplete="name" />
            </label>
            <label>
                Email
                <input type="email" name="email" required maxLength={200} autoComplete="email" />
            </label>
            <label>
                Message
                <textarea name="message" required rows={7} maxLength={5000} />
            </label>
            {/* Honeypot: invisible for people, bots fill it in. */}
            <input
                type="checkbox"
                name="botcheck"
                className={styles.honeypot}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
            />
            {turnstileSiteKey && <div ref={widget} />}
            <button className="button button--primary" type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send message'}
            </button>
            {status === 'error' && (
                <div className="alert alert--danger" role="alert">
                    The message could not be sent. Please complete the verification and try again.
                </div>
            )}
        </form>
    );
}
