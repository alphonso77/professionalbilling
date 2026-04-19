# Professional Billing 

## General Overview

* design a multi-session effort (FE & BE); write the api contracts to enable parallel work
* you're authenticated with gh cli
* consider the repo located at https://github.com/alphonso77/integrasentry
* using its architectural, and coding patterns, implement a professional billing system here
* use clerk for auth
* use stripe for payment processing
* use the same oauth setup to connect to stripe
* the UI should be clean, and minimalist
* there should be dark/light/auto modes
* app will be hosted at `professionalbilling.fratellisoftware.com`
* app will run on Railway services (new project on railway)
* app should be able to be run locally for dev testing

## Further Details

We are building a professional billing app that is target at:

* lawyers
* software consultants
* accountants/cpas
* any professional wanting to log their hours and have invoices automatically generated and/or sent
* the user should be able to create a free account (using clerk)
* our app should listen for the clerk webhooks, follow the same pattern in `integrasentry`
* the user should be presented with a clean interface
* the user should be able to log their hours
* see their hours logged
* see create clients by entering their name and billing infromation
* when the user logs hours, they must assign them to a client in order for automated processing to occur
* the system allows them to leave the client out, but warns them nothing will be processed
* the system also has channels availblbe (start with email, and slack)
* alerts can be configured so the professional (our user) is reminded when an invoice:
    - is about to be generated
    - did get generated
    - was viewed (optional, nice to have)
    - was paid
* the alerts should be fully configurable by the user
* as an added benefit, the system should be flexible for users who do not want to use stripe
* for non-stripe users, the system automatically generates .pdf invoices, and pushes messages to configured channels
* potential future enhancment: offer automated snail-mail sending of invoices, utilizing a service if available
* when an invoice is sent via stripe, the system should listen to relevant stripe webhooks to tell it what happend with the invoice
* nice to have: give the user a 'transfer to my bank' button, enabling them to skip logging into their stripe dashboard
* the system should have clear UI guidance
    - see the IntegraSentry docs design
    - theres a single source of truth for docs & UI guidance in a postgres table
    - the information is sindicated into the UI
    - the ui provides three levels of discovery to the user
    - this keeps the UI clean
    - first level: hovering info bubble
    - second level: click opens a modal
    - thrid level: click inside modal takes you to that area in the full docs

# Principles and Core Values

* don't introduce technical debt, this is a greenfield project
* don't over-sell or undersell UI messaging about what the app does, be honest and transparent
* uphold high coding standards, follow pattners, but be pragmatic if necessary
* keep the user experience always in mind - reduce friction wherever possible
* ensure multi-tenant isolation
* implement the same RLS pattern used in `integrasentry` for defense in depth
* app code should also enforce multi tenant isolation

---- original notes below --- some duplication ----

# Billing Tool App

* this will be a billing tool app
* made specifically for consultants who bill a lot of hours: lawyers, accountants, software developers
* use the same architecture, tech stack, code conventions, and infrastructure (railway) as the IntegraSentry app
* for scaffolding this app, use IntegraSentry as a template
* IntegraSentry's repo is `alphonso77/integrasentry` on github
* you can use github cli to read the `claude.md` and relevant files to understand its architecture, conventions, tech stack, and infrastructure design
* this app is a minimalistic app
* all it does is provide a way for billing to automatically happen
* there will be initial set up of the user's account
* then  the user needs to configure their client's information
* this would incluide the minimum information needed to bill the client
* the user chooses the billing cycle period
* whenever the user does work on behalf of their client, they log hours into the system
* the system automatically sends the user's client an invoice by email
* the system uses stripe for billing
* when the user initially signs up, they need to connect their stripe account, so there will be a minimalistic UI for that
* we probably don't need to connect our stripe account, if we can get away with it this should just be a single user->stripe relationshipo
* the system needs to have multi-tenant isolation
* the isolation needs to be enforced both at the application layer (routes, and queries)
* the isolation also needs to be enforced at the datbase, if possible (I believe postgres offers a built in multi-tenant isolation feature that requires every query to supply an org id)
* the billing tool will be a product offering of Fratelli Software
* www.fratellisoftware.com is where the tool will be marketd
* billingtool.fratellisfotware.com will be the app's UI
* api.fratellisoftware.com will be where the api endpoints live
* the app will be hosted on railway
* clerk can be used for new user identity

# New User Onboarding

1) discover the billing tool app on www.fratellisoftware.com
2) sign up with an email address


# Scope

## Marketing Site 
* stub out a basic marketing site for www.fratellisoftware.com (nothing lives there yet, but we have multiple projects going on in our spare time)
* the main site will just have some basic copy that explains we are a progressive thinking software shop who loves building elegant solutions that solve problems for sole proprieters, and small to medium sized businesses
* you can get information about my professional profile at www.linkedin.com/in/johnyarlott
* my main job is a software engineer at Robbins Research International, but I also build a lot of software on my own and in my spare time because I love the craft
* the web site copy can mention that I work there, but it shouldn't be prominent or the main focus
* the main focus is 

## MVP App
* build the app to an MVP state, having the basic functionality needed
* build the UI of the app, and the api endpoints needed