* double email bug (clerk auth code)
* cleanup users and orgs when a org is deleted from clerk (subscribre to clerk delete webhooks, like IntegraSentry)
* need to add a 'disconnect' stripe integration
    - it should remove the connected account from my stripe account
    - it should also remove whatever database rows are invovled

* when clicking 'connect stripe' the button re-enables itself for a short period, before navigating you to the stripe oauth page

* swagger UI is publicly available, is that okay?

# Testing / Demo Features

* add an ADMIN menu item (only displays for `founder@fratellisoftware.com`)
* first feature is to assign an easter egg to any user
* easter egg is a hidden pi (π) in the top right (see IntegraSentry for pattern)
* pi is hidden until you mouse over
* a modal pops up with a couple of options: seed, re-seed, clean-slate (remove seed)
* see IntegraSentry's data seed feature for patterns
* the seed includes client data, time entries, and unpaid invoices
* it should be as real as possible, meaning you should be able to pay the invoices
    - if this requires some stripe lazy load behavior, that's okay
    - for instance, the seed shouldn't have any stripe api calls as a side effect
    - but if the user clicks on an invoice - there could be a brief loading period where an api call must be made