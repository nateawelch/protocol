// A thick client for getting information about FinancialContract events. This client is kept separate from the
// FinancialContractClient to keep a clear separation of concerns and to limit the overhead from querying the chain.

class FinancialContractEventClient {
  /**
   * @notice Constructs new FinancialContractEventClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} financialContractAbi Financial Contract truffle ABI object to create a contract instance.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} financialContractAddress Ethereum address of the Financial Contract contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    financialContractAbi,
    web3,
    financialContractAddress,
    startingBlockNumber = 0,
    endingBlockNumber = null,
    contractType = "ExpiringMultiParty", // Default to Expiring Multi Party for now to enable backwards compatibility with other bots. This will be removed as soon as the other bots have been updated to work with these contract types.
    contractVersion = "2.0.1"
  ) {
    this.logger = logger;
    this.web3 = web3;

    // Financial Contract contract
    this.financialContract = new this.web3.eth.Contract(financialContractAbi, financialContractAddress);
    this.financialContractAddress = financialContractAddress;

    // Financial Contract Events data structure to enable synchronous retrieval of information.
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];
    this.fundingRateUpdatedEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = startingBlockNumber;

    // Last block number to end the searching for events at.
    this.lastBlockToSearchUntil = endingBlockNumber;
    this.lastUpdateTimestamp = 0;

    if (contractType !== "ExpiringMultiParty" && contractType !== "Perpetual")
      throw new Error(`Invalid type: ${contractType}! This client only supports ExpiringMultiParty or Perpetual`);
    this.contractType = contractType;
    if (contractVersion !== "2.0.1")
      throw new Error(`Invalid version: ${contractVersion}! This client only supports 2.0.1`);
    this.contractVersion = contractVersion;
  }
  // Delete all events within the client
  async clearState() {
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];
    this.fundingRateUpdatedEvents = [];
  }

  getAllNewSponsorEvents() {
    return this.newSponsorEvents;
  }

  getAllLiquidationEvents() {
    return this.liquidationEvents;
  }

  getAllDisputeEvents() {
    return this.disputeEvents;
  }

  getAllDisputeSettlementEvents() {
    return this.disputeSettlementEvents;
  }

  getAllDepositEvents() {
    return this.depositEvents;
  }

  getAllCreateEvents() {
    return this.createEvents;
  }

  getAllWithdrawEvents() {
    return this.withdrawEvents;
  }

  getAllRedeemEvents() {
    return this.redeemEvents;
  }

  getAllRegularFeeEvents() {
    return this.regularFeeEvents;
  }

  getAllFinalFeeEvents() {
    return this.finalFeeEvents;
  }

  getAllLiquidationWithdrawnEvents() {
    return this.liquidationWithdrawnEvents;
  }

  getAllSettleExpiredPositionEvents() {
    return this.settleExpiredPositionEvents;
  }

  getAllFundingRateUpdatedEvents() {
    return this.fundingRateUpdatedEvents;
  }

  // Returns the last update timestamp.
  getLastUpdateTime() {
    return this.lastUpdateTimestamp;
  }

  async update() {
    // The last block to search is either the value specified in the constructor (useful in serverless mode) or is the
    // latest block number (if running in loop mode).
    // Set the last block to search up until.
    const lastBlockToSearch = this.lastBlockToSearchUntil
      ? this.lastBlockToSearchUntil
      : await this.web3.eth.getBlockNumber();

    // Define a config to bound the queries by.
    const blockSearchConfig = { fromBlock: this.firstBlockToSearch, toBlock: lastBlockToSearch };

    // Look for events on chain from the previous seen block number to the current block number.
    const [
      currentTime,
      liquidationEventsObj,
      disputeEventsObj,
      disputeSettlementEventsObj,
      createEventsObj,
      newSponsorEventsObj,
      depositEventsObj,
      withdrawEventsObj,
      redeemEventsObj,
      regularFeeEventsObj,
      finalFeeEventsObj,
      liquidationWithdrawnEventsObj,
      settleExpiredPositionEventsObj,
    ] = await Promise.all([
      this.financialContract.methods.getCurrentTime().call(),
      this.financialContract.getPastEvents("LiquidationCreated", blockSearchConfig),
      this.financialContract.getPastEvents("LiquidationDisputed", blockSearchConfig),
      this.financialContract.getPastEvents("DisputeSettled", blockSearchConfig),
      this.financialContract.getPastEvents("PositionCreated", blockSearchConfig),
      this.financialContract.getPastEvents("NewSponsor", blockSearchConfig),
      this.financialContract.getPastEvents("Deposit", blockSearchConfig),
      this.financialContract.getPastEvents("Withdrawal", blockSearchConfig),
      this.financialContract.getPastEvents("Redeem", blockSearchConfig),
      this.financialContract.getPastEvents("RegularFeesPaid", blockSearchConfig),
      this.financialContract.getPastEvents("FinalFeesPaid", blockSearchConfig),
      this.financialContract.getPastEvents("LiquidationWithdrawn", blockSearchConfig),
      this.contractType == "ExpiringMultiParty" // If the contract is an EMP then find the SettleExpiredPosition events.
        ? this.financialContract.getPastEvents("SettleExpiredPosition", blockSearchConfig)
        : this.financialContract.getPastEvents("SettleEmergencyShutdown", blockSearchConfig), // Else, find the SettleEmergencyShutdown events.
    ]);
    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = currentTime;

    // Process the responses into clean objects.
    // Liquidation events.
    for (let event of liquidationEventsObj) {
      this.liquidationEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        liquidationId: event.returnValues.liquidationId,
        tokensOutstanding: event.returnValues.tokensOutstanding,
        lockedCollateral: event.returnValues.lockedCollateral,
        liquidatedCollateral: event.returnValues.liquidatedCollateral,
      });
    }

    // Dispute events.
    for (let event of disputeEventsObj) {
      this.disputeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        disputer: event.returnValues.disputer,
        liquidationId: event.returnValues.liquidationId,
        disputeBondAmount: event.returnValues.disputeBondAmount,
      });
    }

    // Dispute settlement events.
    for (let event of disputeSettlementEventsObj) {
      this.disputeSettlementEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        disputer: event.returnValues.disputer,
        liquidationId: event.returnValues.liquidationId,
        disputeSucceeded: event.returnValues.disputeSucceeded,
      });
    }

    // Create events.
    for (let event of createEventsObj) {
      this.createEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
        tokenAmount: event.returnValues.tokenAmount,
      });
    }

    // NewSponsor events mapped against PositionCreated events to determine size of new positions created.
    for (let event of newSponsorEventsObj) {
      // Every transaction that emits a NewSponsor event must also emit a PositionCreated event.
      // We assume that there is only one PositionCreated event that has the same block number as
      // the current NewSponsor event.
      const createEvent = this.createEvents.filter((e) => e.blockNumber === event.blockNumber);

      this.newSponsorEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: createEvent[0].collateralAmount,
        tokenAmount: createEvent[0].tokenAmount,
      });
    }

    // Deposit events.
    for (let event of depositEventsObj) {
      this.depositEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
      });
    }

    // Withdraw events.
    for (let event of withdrawEventsObj) {
      this.withdrawEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
      });
    }

    // Redeem events.
    for (let event of redeemEventsObj) {
      this.redeemEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
        tokenAmount: event.returnValues.tokenAmount,
      });
    }

    // Regular fee events.
    for (let event of regularFeeEventsObj) {
      this.regularFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        regularFee: event.returnValues.regularFee,
        lateFee: event.returnValues.lateFee,
      });
    }

    // Final fee events.
    for (let event of finalFeeEventsObj) {
      this.finalFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        amount: event.returnValues.amount,
      });
    }

    // Liquidation withdrawn events.
    for (let event of liquidationWithdrawnEventsObj) {
      this.liquidationWithdrawnEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        withdrawalAmount: event.returnValues.paidToLiquidator,
        liquidationStatus: event.returnValues.liquidationStatus,
      });
    }

    // Settle expired position events.
    for (let event of settleExpiredPositionEventsObj) {
      this.settleExpiredPositionEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        collateralReturned: event.returnValues.collateralReturned,
        tokensBurned: event.returnValues.tokensBurned,
      });
    }

    // Look for perpetual specific events:
    if (this.contractType == "Perpetual") {
      const [fundingRateUpdatedEventsObj] = await Promise.all([
        this.financialContract.getPastEvents("FundingRateUpdated", blockSearchConfig),
      ]);

      // Funding Rate Updated events
      for (let event of fundingRateUpdatedEventsObj) {
        this.fundingRateUpdatedEvents.push({
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          newFundingRate: event.returnValues.newFundingRate,
          updateTime: event.returnValues.updateTime,
          reward: event.returnValues.reward,
        });
      }
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "FinancialContractEventClient",
      message: "Financial Contract event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
}

module.exports = { FinancialContractEventClient };
