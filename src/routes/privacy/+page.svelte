<script lang="ts">
	/**
	 * The privacy policy.
	 *
	 * Every factual claim here is checkable against docs/THREAT-MODEL.md or
	 * against code, which is the standard issue #95 set for it. Where something
	 * is a limitation rather than a protection it says so in the same voice,
	 * because a policy that only lists the good parts is marketing.
	 */
</script>

<svelte:head>
	<title>Privacy — weaveto.do</title>
	<meta name="description" content="What weaveto.do can and cannot see." />
</svelte:head>

<main>
	<a class="back" href="/">&larr; weaveto.do</a>

	<h1>Privacy</h1>
	<p class="lede">
		What the server can see, what it cannot, and where the limits are. If any of this turns out
		to be untrue, that is a security bug and there is an address at the bottom for it.
	</p>

	<h2>There is no account</h2>
	<p>
		No email, no password, no phone number, no social login. Your identity in a room is a
		cryptographic key your device generates. Nothing is collected because nothing is asked for.
	</p>
	<p>
		That identity is <strong>different in every room</strong>. Joining two rooms from the same
		device produces two unrelated keys, so the server cannot tell they are the same person.
	</p>

	<h2>There is no tracking</h2>
	<p>
		No analytics, no tag manager, no session recording, no advertising pixel, no third-party
		script of any kind. The page loads its own code and talks to its own relay, and the content
		security policy in <code>svelte.config.js</code> permits nothing else.
	</p>

	<h2>What the relay cannot see</h2>
	<p>
		Messages and tasks are encrypted on your device before they are sent, using Olm and Megolm
		through the vodozemac library. The relay moves ciphertext between the people in a room and
		holds no key that opens it.
	</p>
	<p>
		<strong>Display names are inside that encryption too.</strong> They used to travel in the clear
		and no longer do.
	</p>

	<h2>What the relay does see</h2>
	<p>Being honest about this is the point of the page.</p>
	<ul>
		<li>
			<strong>Which keys are in which room, while they are connected.</strong> It has to, in order
			to deliver anything. It does not know who those keys belong to.
		</li>
		<li>
			<strong>When messages are sent, and roughly how large they are.</strong> Content is padded
			to fixed blocks, which blunts this without removing it.
		</li>
		<li>
			<strong>The address you connect from.</strong> Unavoidable for any server. It is never written
			to disk, and connections are counted under a keyed hash whose key is random at startup and
			never stored, so the relay's own memory holds no addresses. That protects against a copy of
			its memory and nothing more. It is minimized, not hidden.
		</li>
		<li>
			<strong>A push endpoint, if you turn on notifications.</strong> Enabling them in two rooms
			registers the same endpoint under both, which does link those rooms to one browser. This is
			how Web Push works everywhere and cannot be engineered away here. Do not turn it on if that
			matters to you.
		</li>
	</ul>
	<p>
		Nothing the relay holds is written to disk, and a room's entries are dropped when its last
		member disconnects.
	</p>

	<h2>Notifications carry nothing</h2>
	<p>
		A push notification from this app contains <strong>no payload at all</strong>. The server sends
		an empty ping and your browser composes a generic message locally. No task title, no room name,
		no sender ever reaches the notification.
	</p>

	<h2>What is stored on your device</h2>
	<ul>
		<li>
			<strong>Your identity for a room</strong>, only if you asked to stay signed in on a device
			that has no security key. It is wrapped by a key derived from a PIN you choose, and that key
			is never stored anywhere. Forget the PIN and the identity is gone, which is the trade for
			nobody else being able to open it.
		</li>
		<li>
			<strong>A cache of your tasks</strong>, so a room still works offline. It is encrypted, but
			the key sits in the browser's local storage beside it. That defends against a copy of the
			database file on its own, and not against anything running in your browser. It works this
			way so the app can show your tasks without asking for a PIN first.
		</li>
		<li><strong>Your notification and PIN preferences</strong> for rooms you have joined.</li>
	</ul>
	<p>
		Burning a room removes all of it, then <strong>checks that the removal worked</strong> and tells
		you if anything survived rather than assuming. Closing the tab ends the session regardless:
		message keys live in memory only.
	</p>

	<h2>Other companies involved</h2>
	<ul>
		<li><strong>Vercel</strong> serves the application files and sees requests for them.</li>
		<li>
			<strong>Fly.io</strong> hosts the relay. Their network sees connections arriving before the
			relay does, so the note above about addresses applies to them independently.
		</li>
		<li>
			<strong>Your browser's push service</strong> — Apple, Google or Mozilla — only if you turn on
			notifications. They deliver the empty ping.
		</li>
	</ul>
	<p>Each has its own policy and its own retention. This one cannot speak for them.</p>

	<h2>What this does not protect against</h2>
	<p>
		A compromised device or a malicious browser extension. Anything running in your browser can
		read what you can read, and no amount of encryption between devices changes that. Someone in
		your room can also screenshot or copy anything you share with them.
	</p>

	<h2>Changes, and how to check</h2>
	<p>
		This page changes with the code, in the same repository, with the same history. Nothing here is
		a promise about intent. It is a description of behaviour you can verify.
	</p>
	<p>
		<a href="https://github.com/smledbetter/Weaveto.do/blob/main/docs/THREAT-MODEL.md"
			>The threat model</a
		>
		sets out the same ground in more detail, including the gaps that are accepted and why.
	</p>

	<h2>Contact</h2>
	<p>
		Something wrong here, or a security issue:
		<a href="mailto:weaveto.dosecurity.scribing608@passinbox.com"
			>weaveto.dosecurity.scribing608@passinbox.com</a
		>. Reporting guidance is in
		<a href="https://github.com/smledbetter/Weaveto.do/blob/main/SECURITY.md">SECURITY.md</a>.
	</p>

	<footer>Last updated 2 September 2026.</footer>
</main>

<style>
	main {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
		color: var(--text-primary);
	}

	.back {
		display: inline-block;
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-decoration: none;
		margin-bottom: 2rem;
	}

	.back:hover {
		color: var(--text-primary);
	}

	h1 {
		font-size: 2rem;
		margin: 0 0 0.75rem;
		letter-spacing: -0.02em;
	}

	.lede {
		font-size: 1.05rem;
		color: var(--text-secondary);
		margin: 0 0 2.5rem;
	}

	h2 {
		font-size: 1.1rem;
		margin: 2.25rem 0 0.65rem;
		letter-spacing: -0.01em;
	}

	p {
		margin: 0 0 0.9rem;
		line-height: 1.65;
	}

	ul {
		margin: 0 0 0.9rem;
		padding-left: 1.15rem;
		line-height: 1.65;
	}

	li {
		margin-bottom: 0.55rem;
	}

	code {
		font-size: 0.88em;
		background: var(--bg-raised, rgba(128, 128, 128, 0.12));
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}

	a {
		color: var(--accent-default);
	}

	footer {
		margin-top: 3rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.25));
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
</style>
