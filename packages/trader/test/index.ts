import winston from "winston";
import sinon from "sinon";
import { run } from "../src/index";
import { web3 } from "hardhat";
const { toWei, utf8ToHex, padRight } = web3.utils;

import { interfaceName, addGlobalHardhatTestingAddress, createConstructorParamsForContractVersion } from "@uma/common";

import { getTruffleContract } from "@uma/core";

import { SpyTransport } from "@uma/financial-templates-lib";

describe("index.js", function () {
  let accounts: string[];
  let contractCreator: string;
  let spyLogger: any;
  let spy: any;
  let collateralToken: any;
  let syntheticToken: any;
  let financialContract: any;
  let uniswap: any;
  let store: any;
  let timer: any;
  let mockOracle: any;
  let finder: any;
  let identifierWhitelist: any;
  let configStore: any;
  let collateralWhitelist: any;
  let optimisticOracle: any;
  let defaultPriceFeedConfig: any;
  let constructorParams: any;
  let dsProxyFactory: any;

  let originalEnv: any;

  const identifier = "TEST_IDENTIFIER";
  const fundingRateIdentifier = "TEST_FUNDING";

  const FinancialContract = getTruffleContract("Perpetual", web3 as any);
  const Finder = getTruffleContract("Finder", web3 as any);
  const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3 as any);
  const AddressWhitelist = getTruffleContract("AddressWhitelist", web3 as any);
  const MockOracle = getTruffleContract("MockOracle", web3 as any);
  const Token = getTruffleContract("ExpandedERC20", web3 as any);
  const SyntheticToken = getTruffleContract("SyntheticToken", web3 as any);
  const Timer = getTruffleContract("Timer", web3 as any);
  const UniswapMock = getTruffleContract("UniswapV2Mock", web3 as any);
  const Store = getTruffleContract("Store", web3 as any);
  const ConfigStore = getTruffleContract("ConfigStore", web3 as any);
  const OptimisticOracle = getTruffleContract("OptimisticOracle", web3 as any);
  const DSProxyFactory = getTruffleContract("DSProxyFactory", web3 as any);

  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    originalEnv = process.env;
    accounts = await web3.eth.getAccounts();
    const contractCreator = accounts[0];
    finder = await Finder.new();
    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));
    await finder.changeImplementationAddress(
      web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
      identifierWhitelist.address
    );

    timer = await Timer.new();

    mockOracle = await MockOracle.new(finder.address, timer.address, {
      from: contractCreator,
    });
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
    // Set the address in the global name space to enable disputer's index.js to access it.
    addGlobalHardhatTestingAddress("Voting", mockOracle.address);

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

    // Make the contract creator the admin to enable emergencyshutdown in tests.
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.FinancialContractsAdmin), contractCreator);

    dsProxyFactory = await DSProxyFactory.new();
  });

  beforeEach(async function () {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Create a new synthetic token & collateral token.
    syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });

    collateralWhitelist = await AddressWhitelist.new();
    await finder.changeImplementationAddress(
      web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
      collateralWhitelist.address
    );
    await collateralWhitelist.addToWhitelist(collateralToken.address);

    configStore = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: toWei("0.00001") },
        minFundingRate: { rawValue: toWei("-0.00001") },
        proposalTimePastLimit: 0,
      },
      timer.address
    );

    await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier), 32));
    optimisticOracle = await OptimisticOracle.new(7200, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address);

    // Deploy a new expiring multi party OR perpetual.
    constructorParams = await createConstructorParamsForContractVersion(
      { contractType: "Perpetual", contractVersion: "2.0.1" },
      {
        convertDecimals: toWei, // These tests do not use convertSynthetic. Override this with toWei
        finder,
        collateralToken,
        syntheticToken,
        identifier,
        fundingRateIdentifier,
        timer,
        store,
        configStore: configStore || {}, // if the contract type is not a perp this will be null.
      },
      { expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100 } // config override expiration time.
    );
    financialContract = await FinancialContract.new(constructorParams);
    await syntheticToken.addMinter(financialContract.address);
    await syntheticToken.addBurner(financialContract.address);

    syntheticToken = await Token.at(await financialContract.tokenCurrency());

    uniswap = await UniswapMock.new();
    await uniswap.setTokens(syntheticToken.address, collateralToken.address);

    defaultPriceFeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1,
      getTimeOverride: { useBlockTime: true }, // enable tests to run in hardhat
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });

  it("Runs with no errors", async function () {
    process.env.EMP_ADDRESS = financialContract.address;
    process.env.REFERENCE_PRICE_FEED_CONFIG = JSON.stringify(defaultPriceFeedConfig);
    process.env.TOKEN_PRICE_FEED_CONFIG = JSON.stringify(defaultPriceFeedConfig);
    process.env.DSPROXY_CONFIG = JSON.stringify({ dsProxyFactoryAddress: dsProxyFactory.address });
    process.env.EXCHANGE_ADAPTER_CONFIG = JSON.stringify({
      type: "uniswap-v2",
      tokenAAddress: syntheticToken.address,
      tokenBAddress: collateralToken.address,
    });
    process.env.POLLING_DELAY = "0";

    // Must not throw.
    await run(spyLogger, web3);
  });
});
