import './style.css';

document.addEventListener('DOMContentLoaded', () => {
    const inviteBtn = document.getElementById('inviteDriverBtn');
    const modal = document.getElementById('inviteModal');
    const closeBtn = document.querySelector('.close-btn');
    const form = document.getElementById('inviteForm');
    const driverList = document.getElementById('driverList');

    // Modal Logic
    inviteBtn.addEventListener('click', () => {
        modal.classList.add('show');
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('show');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });

    // Form Submit Mock
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('driverEmail').value;
        
        // Mock API call to invite driver with FLEET_MANAGER context
        console.log(`Inviting ${email} to fleet...`);
        
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="driver-info">
                <strong>${email.split('@')[0]}</strong>
                <span>Invite Pending</span>
            </div>
            <div class="status resting" style="background: rgba(59, 130, 246, 0.2); color: var(--primary);">Pending</div>
        `;
        driverList.prepend(li);
        
        modal.classList.remove('show');
        form.reset();
        alert(`Invite sent to ${email}`);
    });
});
