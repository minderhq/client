/**
 * English messages: the source of truth for the catalog's shape (see
 * ../types.ts). Add a key here first; `tsc` then fails until every other
 * catalog has it too.
 *
 * Placeholders are `{name}`; a plural message is an object of CLDR forms
 * (`one`, `other`, optionally `=0`) and gets `{count}`.
 */
import type { MessageTree } from "../types";

export const en = {
  common: {
    loading: "Loading…",
    pleaseWait: "Please wait…",
    saving: "Saving…",
    sending: "Sending…",
    retry: "Retry",
    retryLoading: "loading {what}",
    tryAgain: "Try again",
    reload: "Reload",
    cancel: "Cancel",
    logIn: "Log in",
    logOut: "Log out",
    signOut: "Sign out",
    email: "Email",
    username: "Username",
    password: "Password",
    or: "or",
    empty: "Nothing here yet.",
    results: { "=0": "No results", one: "{count} result", other: "{count} results" },
  },

  errors: {
    sessionExpired: "Your session expired — log in again.",
    noWorkspace: "You don't have a workspace yet.",
    confirmEmail: "Confirm your email address to continue.",
    requestFailed: "Request failed ({status})",
    forbidden: "You don't have permission to do this.",
    rateLimited: "The server is busy right now. Wait a moment and try again.",
    rateLimitedRetryIn: "The server is busy right now. Try again in {seconds} s.",
    notFound: "We couldn't find what you were looking for.",
    crashTitle: "This page hit an unexpected error",
    crashBody:
      "The rest of the app still works — pick another page from the menu, or reload to try again.",
  },

  shell: {
    tagline: "Control Center",
    mainNav: "Main",
    toggleNav: "Toggle navigation",
    openPalette: "Open command palette",
    searchOrJump: "Search or jump to…",
    tabsLabel: "{group} sections",
    breadcrumb: "Breadcrumb",
  },

  access: {
    forbiddenTitle: "You don't have access to this page",
    forbiddenBody: "This page is open to {audience}.",
    audience: {
      members: "members of this organization",
      orgAdmins: "organization owners and admins",
      teamAdmins: "the team's admins",
      billing: "people who can see this organization's billing",
      platformAdmins: "platform admins",
    },
    requestAccess: "Request access",
    requestAccessSoon: "Access requests are coming soon. Until then, ask an organization admin.",
    signInTitle: "Sign in to continue",
    signInBody: "You need to be signed in to see this page.",
    backHome: "Back to home",
  },

  notFound: {
    title: "Page not found",
    body: "There is no page at {path}. It may have moved, or the link may be wrong.",
    search: "Search pages",
    backHome: "Back to home",
  },

  theme: {
    system: "System",
    light: "Light",
    dark: "Dark",
    matchSystem: "Match system",
    toggleTitle: "Theme: {theme} (click to change)",
    toggleLabel: "Theme: {theme}. Click to switch.",
  },

  palette: {
    dialog: "Command palette",
    search: "Search pages and actions",
    placeholder: "Search pages and actions…",
    results: "Results",
    noMatches: "No matches for “{query}”.",
    goTo: "Go to {group}",
    escape: "Esc",
    groupActions: "Actions",
    groupKnowledgeBase: "Knowledge base",
    groupPipeline: "Pipeline",
    groupPlugin: "Plugin",
    openInKnowledgeBases: "Open in Knowledge Bases",
    openInPipelines: "Open in Pipelines",
    openInDiscoverPlugins: "Open in Discover plugins",
    actions: {
      ask: { label: "Ask a question", sublabel: "Query your knowledge", keywords: "chat rag query" },
      kb: { label: "New knowledge base", sublabel: "Upload documents", keywords: "create add upload" },
      pipeline: { label: "New pipeline", sublabel: "Combine knowledge bases", keywords: "create add" },
      model: { label: "Pull a model", sublabel: "Ollama model lifecycle", keywords: "download install ollama" },
      theme: { label: "Toggle theme", sublabel: "System / light / dark", keywords: "dark light mode appearance" },
    },
  },

  nav: {
    /** A tab's palette label when it has no page title of its own. */
    tabInGroup: "{group}: {tab}",
    sections: {
      overview: "Overview",
      knowledge: "Knowledge",
      marketplace: "Marketplace",
      ai: "AI & system",
      team: "Team",
      account: "My account",
      organization: "Organization",
      platform: "Platform",
    },
    items: {
      home: { label: "Home", description: "Your workspace at a glance", keywords: "dashboard overview start" },
      ask: { label: "Ask", description: "Chat with your knowledge", keywords: "chat query question rag answer" },
      knowledgeBases: { label: "Knowledge Bases", description: "Upload & manage your documents", keywords: "documents kb corpus upload files" },
      pipelines: { label: "Pipelines", description: "Set up question-answering over your documents", keywords: "retrieval query hyde self-rag q&a" },
      conversations: { label: "Conversations", description: "Revisit your past chats", keywords: "history threads chat" },
      publicChat: { label: "Public Chat", description: "Publish a public chatbot over a pipeline (admin)", keywords: "public chatbot widget endpoint slug anonymous embed share rate limit" },
      knowledgeGraph: { label: "Knowledge Graph", description: "Entities, categories & merges from your documents", keywords: "neo4j entities relationships correlation taxonomy categories merge same_as dedup" },
      graph: { label: "Graph", description: "Entities and how they connect" },
      taxonomyReview: { label: "Taxonomy Review", description: "Approve AI-suggested entity categories" },
      entityMerges: { label: "Entity Merge Review", description: "Approve cross-org SAME_AS entity links (dual-control)" },
      discover: { label: "Discover", description: "Find plugins, AI tools and service bundles to add", keywords: "marketplace catalog browse store available install extensions" },
      discoverPlugins: { label: "Plugins", title: "Discover plugins", description: "The plugin catalog, filterable by source", keywords: "plugin connectors source first-party private git submitted mindhub" },
      discoverAiTools: { label: "AI tools", title: "Discover AI tools", description: "Every AI tool plugins offer, running or not", keywords: "ai tool function calling ollama actions" },
      discoverServiceBundles: { label: "Service bundles", title: "Discover service bundles", description: "Service bundles you can turn on", keywords: "bundle services capabilities enable monitoring inference voice" },
      installed: { label: "Installed", description: "Everything on this installation: version, health and settings", keywords: "marketplace running runtime enabled manage configure" },
      installedPlugins: { label: "Plugins", title: "Installed plugins", description: "What runs on this installation, plus your installs", keywords: "plugin running runtime version health first-party config settings enable disable uninstall" },
      installedAiTools: { label: "AI tools", title: "Installed AI tools", description: "AI tools the assistant can call right now", keywords: "ai tool live callable function calling" },
      installedServiceBundles: { label: "Service bundles", title: "Installed service bundles", description: "Service bundles turned on, their images, export and import", keywords: "bundle services enabled reconcile export import docker" },
      publish: { label: "Publish", description: "Submit your own plugins; review submissions (admin)", keywords: "marketplace plugins publish developer author" },
      submissions: { label: "Submissions", title: "Plugin submissions", description: "Submit a plugin and follow its review", keywords: "submit draft upload" },
      submissionReview: { label: "Submission review", title: "Submission review", description: "Approve or reject submitted plugins (admin)", keywords: "review queue approve reject moderation" },
      models: { label: "Models", description: "Local LLMs (Ollama): pull, test, remove", keywords: "ollama llm pull download" },
      providers: { label: "Providers & defaults", description: "Default models per task; connect OpenAI-compatible or Anthropic providers (admin)", keywords: "openai anthropic cloud remote provider api key credential default models answer chat extraction utility" },
      voice: { label: "Voice", description: "Text-to-speech & speech-to-text", keywords: "tts stt speech piper transcribe" },
      backups: { label: "Backups", description: "Snapshot & restore the platform", keywords: "restore archive snapshot" },
      status: { label: "Status", description: "Service health & recent logs", keywords: "health services uptime logs" },
      orgOverview: { label: "Overview", description: "Your org, its invites & switching", keywords: "organization tenant workspace switch invites" },
      orgUsers: { label: "Users", description: "This org's members: roles, suspend, remove, account resets", keywords: "users members people accounts suspend remove reset password deactivate roles" },
      billing: { label: "Billing", title: "Billing", description: "Your plan, subscription & upgrades", keywords: "subscription plan upgrade payment tier pricing invoice" },
      licenses: { label: "Licenses", title: "Plugin licenses", description: "The plugin tiers licensed to your account (display-only)", keywords: "my licenses tier plugin" },
      account: { label: "Profile & settings", description: "Your profile, password and preferences", keywords: "account profile password settings preferences me" },
      teams: { label: "Teams", description: "Group people & share resources", keywords: "groups members sharing collaborate" },
      requests: { label: "Requests", title: "Requests", description: "What you asked for, and requests waiting for your decision", keywords: "request approve reject inbox pending install model join team" },
      allOrganizations: { label: "All Organizations", description: "Every org on the instance + provisioning (admin)", keywords: "organizations tenants provision create admin" },
      allUsers: { label: "All Users", description: "Every account on the installation, across orgs (Platform Admin)", keywords: "users accounts roles platform admin people members instance" },
      audit: { label: "Audit Log", description: "Append-only record of privileged actions (admin)", keywords: "audit log security history who did what siem" },
      sources: { label: "MindHub & sources", title: "MindHub & sources", description: "Where this installation's plugins come from (operators)", keywords: "mindhub sources plugin source repositories git private mirror connect operator platform admin" },
    },
  },

  auth: {
    login: {
      titleLogin: "Log in",
      titleRegister: "Create an account",
      introLogin:
        "Sign in with your Minder account to make changes. Browsing stays open without logging in.",
      introRegister: "Create a local Minder account, then you'll be signed in.",
      forgotLink: "Forgot password?",
      forgotAskAdmin: "Forgot your password? Ask your administrator to reset it.",
      submitRegister: "Create account & log in",
      inviteOnly:
        "No account yet? Accounts on this instance are created by invitation. If you were invited, open the link in your invitation. Otherwise, ask an administrator of your organization to invite you.",
      ssoOnly: "No account yet? Sign-up is turned off on this instance.",
      ssoOnlyUseSso: "Sign in with SSO below; your account is set up the first time you do.",
      ssoOnlyAskAdmin: "Ask an administrator to create an account for you.",
      noAccount: "No account yet?",
      createOne: "Create one",
      haveAccount: "Already have an account?",
      ssoButton: "Sign in with SSO (Authelia)",
      ssoNeedsDomain:
        "SSO requires reaching Minder through its Traefik hostname with a real domain + TLS.",
      ssoResetNote: "SSO accounts reset their password at their identity provider.",
    },
    callback: {
      completing: "Completing sign-in…",
      incomplete: "Sign-in did not complete — please try again.",
    },
    forgot: {
      title: "Reset your password",
      intro:
        "Enter the email address of your Minder account and we'll send you a link to choose a new password.",
      askAdmin:
        "Password reset by email isn't available on this server. Ask your administrator to reset your password.",
      ssoNote:
        "If you sign in with SSO, your password is managed by your identity provider: reset it there. Requesting a link here sends an SSO account a reminder email instead of a reset link.",
      backToLogin: "Back to log in",
    },
    resetRequest: {
      sent:
        "If an account exists for that address, we've sent it a link to reset your password. Check your inbox and spam folder. The link works once and expires within an hour.",
      rateLimited: "Too many requests. Wait a minute, then try again.",
      invalidEmail: "Enter a valid email address.",
      failed: "The request could not be sent right now. Try again later.",
      submit: "Send reset link",
    },
    reset: {
      title: "Choose a new password",
      done: "Your password has been reset. Log in with your new password.",
      hint:
        "Use at least {min} characters. The limit is {max} bytes: that's {max} plain letters or digits, fewer with accents or emoji.",
      tooLong:
        "This password is too long. Keep it under {max} bytes: accented letters, other scripts and emoji count as 2 to 4 each.",
      tooShort: {
        one: "Password must be at least {count} character.",
        other: "Password must be at least {count} characters.",
      },
      mismatch: "The two passwords don't match.",
      rateLimited: "Too many attempts. Wait a minute, then try again.",
      rejected:
        "The server rejected this password. Use at least {min} characters and at most {max} bytes.",
      failed: "The password could not be reset right now. Try again later.",
      expired:
        "This reset link is invalid or has expired. Each link works once and only for a limited time, and requesting a new one cancels the older ones. Send yourself a new link below.",
      newLink: "Send me a new link",
      needsLink: "This page needs the link from a password reset email.",
      requestNewLink: "Request a new link",
      signedIn: "You're signed in.",
      signedInAs: "You're signed in as {username}.",
      signOutFirst:
        "Resetting a password signs that account out everywhere, so sign out first to continue.",
      signOutAndContinue: "Sign out and continue",
      newPassword: "New password",
      confirmPassword: "Confirm new password",
      showPasswords: "Show passwords",
      hidePasswords: "Hide passwords",
      submit: "Set new password",
    },
    forceChange: {
      title: "Change your password",
      subtitle: "An administrator reset your password. Choose a new one to continue.",
      callout:
        "Enter the password your administrator gave you as the current password, then choose a new one that only you know.",
    },
  },

  organization: {
    defaultLanguage: {
      heading: "Default language",
      label: "Default language for members",
      none: "None (each member's browser language)",
      hint: "Members who haven't chosen a language in their own settings see Minder in this one.",
      saved: "Default language saved.",
      saveFailed: "Couldn't save the default language, so the previous one is back. {error}",
    },
  },

  auditLog: {
    scopeOrg: "Showing the audit log of {org} and its sub-organizations.",
    scopeInstance: "Showing the whole installation's audit log (Platform Admin).",
    noOrg: "You're not in an organization, so there's no audit log to show.",
  },

  publicChat: {
    apiAddressLabel: "API address (for developers)",
    apiAddressHint: "The visitor chat page and embed code are coming soon.",
    copyApiAddress: "Copy API address",
  },

  settings: {
    title: "Settings",
    intro: "Your account, as Minder currently sees it.",
    account: "Account",
    role: "Role",
    identityNote:
      "Signed in via Authelia SSO or a local Minder account. A local account can change its password below; for an SSO account, change your password or group membership in {portal} — that's the actual identity source for SSO logins, not this page.",
    portalLink: "Authelia's own portal",
    portalPlain: "your identity provider's portal (Authelia)",
    profile: {
      heading: "Minder profile",
      intro:
        "Minder's own per-user preferences — separate from your Authelia identity above. These are saved to your account, so they follow you across devices.",
      displayName: "Display name",
      displayNameHint:
        "How Minder addresses you in its own UI. Leave blank to use your username ({username}). This does not change your Authelia identity.",
      theme: "Theme",
      themeHint: "Applied immediately and remembered on your account.",
      saved: "Profile saved.",
      save: "Save profile",
    },
    language: {
      heading: "Language",
      label: "Display language",
      hint: "Applied immediately and saved to your account, so it follows you across devices.",
      saveFailed: "Couldn't save your language, so the previous one is back. {error}",
    },
    password: {
      heading: "Change password",
      intro:
        "For local Minder accounts. Accounts that sign in via Authelia SSO change their password in the Authelia portal instead.",
      current: "Current password",
      new: "New password",
      confirm: "Confirm new password",
      minHint: { one: "At least {count} character.", other: "At least {count} characters." },
      tooShort: {
        one: "New password must be at least {count} character.",
        other: "New password must be at least {count} characters.",
      },
      mismatch: "New passwords don't match.",
      unchanged: "New password must differ from the current password.",
      changed: "Password changed.",
      changing: "Changing…",
      submit: "Change password",
    },
  },

  models: {
    size: "{size} GB",
    fit: {
      fits: "Fits the GPU",
      partial: "Partial offload (slow, uses RAM)",
      tooLarge: "Too large",
    },
    fitLabel: "GPU fit",
    confirm: {
      title: "This model doesn't fit in the GPU",
      partial:
        "This model ({model}, ~{size} GB) does not fit in the GPU; layers will run from system RAM and the host may slow down or freeze.",
      tooLarge:
        "This model ({model}, ~{size} GB) is too large for this host; layers will run from system RAM, so loading it may fail or freeze the host.",
      useAnyway: "Use it anyway",
    },
  },

  providers: {
    apiKeyOptional: "optional",
    loopbackHint:
      "Minder runs in Docker: use your machine's LAN IP or host.docker.internal, not localhost.",
    localNoModels:
      "No models listed: this server's models won't appear in model pickers until you fetch them. After adding it, use Fetch models on its card and save the list.",
    adapterNote: "Served by the {adapter} adapter (port {port})",
    adapterNoteNoPort: "Served by the {adapter} adapter",
    piiMasking: "Mask personal data before it is sent to this provider",
    piiMaskingHelp:
      "Emails, phone numbers, IBAN and card numbers, national IDs and IP addresses are replaced with placeholders and restored in the reply.",
  },

  onboarding: {
    model: {
      step: "Model",
      title: "Connect a model",
      noModel:
        "No language model is available yet, so uploads can't be embedded and Ask can't answer. Pull a model into Ollama or connect a vLLM or cloud provider first.",
      unavailable:
        "The model service isn't answering, so uploads can't be embedded and Ask can't answer. Check the model backend, or connect a vLLM or cloud provider.",
      providers: "Open Providers & defaults",
      docs: "How to connect your models",
      askAdmin: "No model is connected yet. Ask an administrator to connect a model.",
    },
    checklist: {
      title: "Getting started",
      progress: "{done} of {total} done",
      hide: "Hide Getting started",
      done: "Done",
      notDone: "Not done yet",
      markDone: "Mark as done",
      skip: "Skip",
      skipStep: "Skip: {step}",
      markStepDone: "Mark as done: {step}",
      saveFailed: "Couldn't save that change. Try again.",
      serviceUnavailable: "This can't be checked right now: the service isn't answering.",
      notAuthorized: "You can't see this yet. Ask an administrator.",
      steps: {
        knowledgeBase: {
          title: "Create your first knowledge base",
          hint: "A knowledge base holds the documents Minder answers from. Share it with your organization so everyone can ask it.",
        },
        upload: {
          title: "Upload a document",
          hint: "Add a PDF, TXT or Markdown file so there is something to search.",
        },
        assistant: {
          title: "Set up an assistant",
          hint: "An assistant answers questions from one or more knowledge bases. You'll find it under Pipelines.",
        },
        ask: {
          title: "Ask your first question",
          hint: "Answers show the passages they come from.",
        },
        invite: {
          title: "Invite your teammates",
          hint: "Send invites from your organization's page.",
        },
        email: {
          title: "Set up email",
          hint: "This installation doesn't deliver email yet, so invites and password resets have to be shared as links. Configure an email backend in the installation settings.",
        },
        useKb: {
          title: "Use a knowledge base",
          hint: "Open a knowledge base shared with you, or create your own and upload a document.",
        },
        profile: {
          title: "Complete your profile",
          hint: "Choose your language and preferences. They follow you across devices.",
        },
      },
    },
  },

  home: {
    greetingFirst: "Welcome to Minder, {name}",
    greetingReturning: "Welcome back, {name}",
    greeting: "Hello, {name}",
    introFirst: "A few short steps below get you to your first answer.",
    introReturning: "Pick up where you left off.",
    introAnonymous: "Browsing is open for everyone. Log in on any page to make changes.",
    ask: "Ask a question",
    shortcuts: "Shortcuts",
  },
  requests: {
    kinds: {
      join: "Join the organization",
      invite: "Invite someone",
      team_join: "Join a team",
      plugin_install: "Install a plugin",
      model_request: "Make a model available",
      plan_request: "Change the plan",
    },
    status: {
      pending: "Pending",
      approved: "Approved",
      denied: "Rejected",
      expired: "Expired",
      withdrawn: "Withdrawn",
    },
    teamNumber: "team #{id}",
    reason: "Reason: {reason}",
    pendingBadge: { one: "{count} request waiting for your decision", other: "{count} requests waiting for your decision" },
    followUp: {
      install_plugin: "Approved. Now install the plugin from Discover plugins.",
      enable_model: "Approved. Now pull the model or connect its provider.",
      change_plan: "Approved. Now change the plan under Billing.",
    },
    send: {
      pluginInstall: "Request install",
      pluginInstallTitle: "Ask an admin to install {name}",
      model: "Request a model",
      modelTitle: "Ask for a model",
      teamJoin: "Ask to join",
      teamJoinTitle: "Ask to join {name}",
      adminRoute: "Your organization's admins get this request. You'll see their answer under Requests.",
      teamJoinRoute: "The team's admins get this request, or the organization's admins when the team has none. You'll see their answer under Requests.",
      subjectLabel: "Which model do you need?",
      subjectPlaceholder: "e.g. llama3.1:8b or a cloud model",
      subjectRequired: "Enter the model you need.",
      noteLabel: "Note (optional)",
      noteHint: "Why you need it, so the admin can decide faster.",
      submit: "Send request",
      sent: "Request sent. You'll see the answer under Requests.",
      sentButton: "Requested",
      viewRequests: "View my requests",
      close: "Close",
      exists: "You already asked for this. Your request is still pending.",
      cooldown: "You can ask for this again on {date}.",
      cooldownNoDate: "You asked for this recently. Try again later.",
    },
    page: {
      subtitle: "Follow what you asked for. If you decide requests, the ones routed to you are here too.",
      inboxHeading: "Waiting for your decision",
      inboxEmpty: "No requests are waiting for you.",
      inboxLoadError: "Couldn't load the requests routed to you.",
      mineHeading: "My requests",
      mineEmpty: "You haven't asked for anything yet. Request a plugin in Discover plugins, a model under Models, or to join a team under Teams.",
      mineLoadError: "Couldn't load your requests.",
      sentOn: "Sent {date}",
      expiresOn: "closes on its own on {date}",
      decidedOn: "decided {date}",
      askedBy: "Asked by {name}",
      someone: "someone",
      note: "Note: {note}",
      approve: "Approve",
      reject: "Reject",
      approved: "Approved.",
      rejected: "Rejected.",
      approvedBy: "Approved by {name}.",
      rejectedBy: "Rejected by {name}.",
      alreadyDecided: "Someone else decided this request first.",
      rejectTitle: "Reject this request?",
      rejectReason: "Reason (the requester sees it)",
      rejectSubmit: "Reject request",
    },
  },
} satisfies MessageTree;
