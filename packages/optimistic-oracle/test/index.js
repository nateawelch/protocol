// Script to test
const Main = require("../index.js");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");

const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");
const { getTruffleContract } = require("@uma/core");
const { addGlobalHardhatTestingAddress } = require("@uma/common");

const OptimisticOracle = getTruffleContract("OptimisticOracle", web3);
const MockOracle = getTruffleContract("MockOracleAncillary", web3);
const Finder = getTruffleContract("Finder", web3);
const Timer = getTruffleContract("Timer", web3);

contract("index.js", function () {
  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between performing retries

  let finder;
  let timer;
  let optimisticOracle;
  let mockOracle;

  before(async function () {
    finder = await Finder.new();
    timer = await Timer.new();
    mockOracle = await MockOracle.new(finder.address, timer.address);

    // Deploy a new OptimisticOracle.
    optimisticOracle = await OptimisticOracle.new("120", finder.address, timer.address);

    // Set addresses in the global name space that the OO proposer's index.js needs to fetch:
    addGlobalHardhatTestingAddress("OptimisticOracle", optimisticOracle.address);
    addGlobalHardhatTestingAddress("Voting", mockOracle.address);
  });

  it("Completes one iteration without logging any errors", async function () {
    // We will create a new spy logger, listening for debug events because success logs are tagged with the
    // debug level.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    await Main.run({ logger: spyLogger, web3, pollingDelay, errorRetries, errorRetriesTimeout });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // The first log should indicate that the OO-Proposer runner started successfully
    // and auto detected the OO's deployed address.
    assert.isTrue(spyLogIncludes(spy, 0, "OptimisticOracle proposer started"));
    assert.isTrue(spyLogIncludes(spy, 0, optimisticOracle.address));
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
});
