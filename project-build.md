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