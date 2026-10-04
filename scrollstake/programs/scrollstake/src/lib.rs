use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// Placeholder. Run `anchor keys sync` after the first build to replace it.
declare_id!("7mDauA2UnGfJsy7TPQLRJT5wc5HbExaXMoicnxM2Dk96");

const MAX_GROUP_ID: usize = 16;

#[program]
pub mod scrollstake {
    use super::*;

    /// Creates the group and its pool token account. Signer = authority (session creator).
    pub fn create_group(ctx: Context<CreateGroup>, group_id: String) -> Result<()> {
        require!(group_id.len() <= MAX_GROUP_ID, ScrollError::GroupIdTooLong);
        let g = &mut ctx.accounts.group;
        g.authority = ctx.accounts.authority.key();
        g.oracle = ctx.accounts.oracle.key();
        g.mint = ctx.accounts.mint.key();
        g.pool = ctx.accounts.pool.key();
        g.group_id = group_id;
        g.penalty_total = 0;
        g.bump = ctx.bumps.group;
        Ok(())
    }

    /// Member moves tokens into the group pool and gets credited in their Stake account.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ScrollError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.member_ata.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                    authority: ctx.accounts.member.to_account_info(),
                },
            ),
            amount,
        )?;

        let s = &mut ctx.accounts.stake;
        if s.member == Pubkey::default() {
            s.member = ctx.accounts.member.key();
            s.group = ctx.accounts.group.key();
            s.bump = ctx.bumps.stake;
        }
        s.amount = s.amount.checked_add(amount).ok_or(ScrollError::Overflow)?;
        Ok(())
    }

    /// Oracle (our backend) penalizes a member. Tokens stay in the pool (the hang-out fund).
    pub fn slash(ctx: Context<Slash>, amount: u64) -> Result<()> {
        let s = &mut ctx.accounts.stake;
        let taken = amount.min(s.amount);
        s.amount -= taken;
        s.slashed = s.slashed.checked_add(taken).ok_or(ScrollError::Overflow)?;
        s.strikes = s.strikes.saturating_add(1);

        let g = &mut ctx.accounts.group;
        g.penalty_total = g.penalty_total.checked_add(taken).ok_or(ScrollError::Overflow)?;

        emit!(Slashed {
            group: g.key(),
            member: s.member,
            amount: taken,
            remaining: s.amount,
            strikes: s.strikes,
        });
        Ok(())
    }

    /// Member takes back whatever is left of their stake.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let amount = ctx.accounts.stake.amount;
        require!(amount > 0, ScrollError::ZeroAmount);
        ctx.accounts.stake.amount = 0;

        let group_id = ctx.accounts.group.group_id.clone();
        let bump = ctx.accounts.group.bump;
        let seeds: &[&[u8]] = &[b"group", group_id.as_bytes(), &[bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool.to_account_info(),
                    to: ctx.accounts.member_ata.to_account_info(),
                    authority: ctx.accounts.group.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        Ok(())
    }
}

// ---------- accounts ----------

#[account]
pub struct Group {
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub group_id: String,
    pub penalty_total: u64,
    pub bump: u8,
}
impl Group {
    // 8 discriminator + 4 pubkeys + (4 + 16) string + u64 + u8
    pub const SPACE: usize = 8 + 32 * 4 + (4 + MAX_GROUP_ID) + 8 + 1;
}

#[account]
pub struct Stake {
    pub member: Pubkey,
    pub group: Pubkey,
    pub amount: u64,
    pub slashed: u64,
    pub strikes: u16,
    pub bump: u8,
}
impl Stake {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 2 + 1;
}

// ---------- contexts ----------

#[derive(Accounts)]
#[instruction(group_id: String)]
pub struct CreateGroup<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: only its pubkey is stored; it later signs `slash`.
    pub oracle: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = Group::SPACE,
        seeds = [b"group", group_id.as_bytes()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(
        init,
        payer = authority,
        seeds = [b"pool", group.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = group
    )]
    pub pool: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub member: Signer<'info>,
    #[account(
        seeds = [b"group", group.group_id.as_bytes()],
        bump = group.bump
    )]
    pub group: Account<'info, Group>,
    #[account(
        init_if_needed,
        payer = member,
        space = Stake::SPACE,
        seeds = [b"stake", group.key().as_ref(), member.key().as_ref()],
        bump
    )]
    pub stake: Account<'info, Stake>,
    #[account(
        mut,
        seeds = [b"pool", group.key().as_ref()],
        bump,
        address = group.pool
    )]
    pub pool: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = group.mint,
        token::authority = member
    )]
    pub member_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Slash<'info> {
    #[account(address = group.oracle @ ScrollError::NotOracle)]
    pub oracle: Signer<'info>,
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_bytes()],
        bump = group.bump
    )]
    pub group: Account<'info, Group>,
    #[account(
        mut,
        seeds = [b"stake", group.key().as_ref(), stake.member.as_ref()],
        bump = stake.bump
    )]
    pub stake: Account<'info, Stake>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub member: Signer<'info>,
    #[account(
        seeds = [b"group", group.group_id.as_bytes()],
        bump = group.bump
    )]
    pub group: Account<'info, Group>,
    #[account(
        mut,
        seeds = [b"stake", group.key().as_ref(), member.key().as_ref()],
        bump = stake.bump
    )]
    pub stake: Account<'info, Stake>,
    #[account(
        mut,
        seeds = [b"pool", group.key().as_ref()],
        bump,
        address = group.pool
    )]
    pub pool: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = group.mint,
        token::authority = member
    )]
    pub member_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ---------- events & errors ----------

#[event]
pub struct Slashed {
    pub group: Pubkey,
    pub member: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    pub strikes: u16,
}

#[error_code]
pub enum ScrollError {
    #[msg("group_id must be at most 16 bytes")]
    GroupIdTooLong,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("math overflow")]
    Overflow,
    #[msg("signer is not the group oracle")]
    NotOracle,
}
