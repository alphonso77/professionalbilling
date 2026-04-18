# Next Effort

## Phase 1

* ~time entry should not allow $0 log entries~ <- nvm on this one, maybe the professional wants to log free work    
    - just warn the user so they don't do it by mistake
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

## Phase 2

* provide a feedback section - this is a generic form that can capture:
    - bug reports
    - feature requests
    - UI feedback on improvements
    - the form should be prominent, have a 'feedback' link in the main menu
    - the feedback should go directly to our DB, and surfaced in the admin area
    - optionally, the user should have an area showing feedback sent, and a status (pending, acknowledged, clarification requested)
* need to add a 'disconnect' stripe integration
    - it should remove the connected account from my stripe account
    - it should also remove whatever database rows are invovled
* when clicking 'connect stripe' the button re-enables itself for a short period, before navigating you to the stripe oauth page
* double email bug upon signup - we had the same bug in IntegraSentry, it happened to be something with the react component double rendering and causing clerk to send the email twice
* need to listen for clerk delete org/user webhooks (see how IntegraSentry does this)
    - if an org is deleted from clerk, all org/user data should get cleaned up in our DB
    - a future effort can decide which data needs to stay for historical/record keeping purposes
* include an admin feature for a complete DB reset
    - should optionally clean up clerk
    - optionally remove `founder@fratellisoftware.com` (in which case, user gets booted out and must create a new user)
    - with `founder@fratellisoftware.com` staying (mode) just leave what's necessary for them to log in, but remove all data like invoices, time, clients, etc.